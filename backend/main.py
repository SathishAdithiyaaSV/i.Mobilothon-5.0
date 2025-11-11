from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime, timedelta
from typing import List, Dict, Optional
from pydantic import BaseModel, Field, EmailStr
from bson import ObjectId
from passlib.context import CryptContext
from jose import JWTError, jwt
import json
import base64
import uuid
import os
from pathlib import Path
import math
from dotenv import load_dotenv

# ============================================
# CONFIGURATION
# ============================================
load_dotenv()

MONGODB_URL = os.getenv("MONGODB_URL")
DATABASE_NAME = "road_hazard_db"
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()


# ============================================
# Pydantic MODELS
# ============================================
class PyObjectId(ObjectId):
    @classmethod
    def __get_validators__(cls):
        yield cls.validate
    @classmethod
    def validate(cls, v):
        if not ObjectId.is_valid(v):
            raise ValueError("Invalid ObjectId")
        return ObjectId(v)
    @classmethod
    def __modify_schema__(cls, field_schema):
        field_schema.update(type="string")


class LocationUpdate(BaseModel):
    latitude: float
    longitude: float
    timestamp: str


class HazardReport(BaseModel):
    latitude: float
    longitude: float
    hazardType: str
    description: str
    timestamp: str
    photo: Optional[str] = None  # base64 encoded image string


class UserLocation(BaseModel):
    user_id: str
    latitude: float
    longitude: float
    timestamp: datetime
    last_updated: datetime


class UserSignup(BaseModel):
    name: str
    email: EmailStr
    password: str


class UserLogin(BaseModel):
    email: EmailStr
    password: str


class Token(BaseModel):
    token: str
    user: dict


class User(BaseModel):
    id: str
    name: str
    email: str
    created_at: datetime


# ============================================
# APP INITIALIZATION
# ============================================
app = FastAPI(title="Road Hazard Detection API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

mongodb_client: Optional[AsyncIOMotorClient] = None
db = None


# ============================================
# AUTH HELPERS
# ============================================
def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)

def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)

def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)

async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token payload")
    except JWTError:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user = await db.users.find_one({"_id": ObjectId(user_id)})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


# ============================================
# CONNECTION MANAGER
# ============================================
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.user_locations: Dict[str, UserLocation] = {}

    async def connect(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        self.active_connections[user_id] = websocket
        print(f"User {user_id} connected ({len(self.active_connections)} total)")

    def disconnect(self, user_id: str):
        self.active_connections.pop(user_id, None)
        self.user_locations.pop(user_id, None)
        print(f"User {user_id} disconnected")

    async def send_personal_message(self, message: dict, user_id: str):
        ws = self.active_connections.get(user_id)
        if ws:
            try:
                await ws.send_json(message)
            except Exception as e:
                print(f"Send error to {user_id}: {e}")

    async def broadcast_hazard_to_nearby(self, hazard_data: dict, reporter_location: dict, radius_km: float = 5.0):
        """Broadcast hazard alert to users within radius_km"""
        reporter_lat = reporter_location["latitude"]
        reporter_lon = reporter_location["longitude"]
        notified_users = []

        for user_id, location in self.user_locations.items():
            if user_id == hazard_data.get("reporter_id"):
                continue
            distance = self.calculate_distance(reporter_lat, reporter_lon, location.latitude, location.longitude)
            if distance <= radius_km * 1000:
                alert_message = {
                    "type": "hazard_alert",
                    "payload": {
                        "id": hazard_data["id"],
                        "hazardType": hazard_data["hazardType"],
                        "description": hazard_data["description"],
                        "latitude": hazard_data["latitude"],
                        "longitude": hazard_data["longitude"],
                        "timestamp": hazard_data["timestamp"],
                        "photoUrl": hazard_data.get("photoUrl"),
                        "distance": round(distance, 2)
                    }
                }
                await self.send_personal_message(alert_message, user_id)
                notified_users.append(user_id)
        return notified_users

    def update_user_location(self, user_id: str, latitude: float, longitude: float):
        now = datetime.utcnow()
        self.user_locations[user_id] = UserLocation(
            user_id=user_id,
            latitude=latitude,
            longitude=longitude,
            timestamp=now,
            last_updated=now
        )

    @staticmethod
    def calculate_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
        R = 6371000
        phi1, phi2 = math.radians(lat1), math.radians(lat2)
        dphi = math.radians(lat2 - lat1)
        dlambda = math.radians(lon2 - lon1)
        a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
        return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


manager = ConnectionManager()


# ============================================
# STARTUP / SHUTDOWN
# ============================================
@app.on_event("startup")
async def startup_db_client():
    global mongodb_client, db
    mongodb_client = AsyncIOMotorClient(MONGODB_URL)
    db = mongodb_client[DATABASE_NAME]
    await db.hazards.create_index([("location", "2dsphere")])
    print("✅ Connected to MongoDB")

@app.on_event("shutdown")
async def shutdown_db_client():
    if mongodb_client:
        mongodb_client.close()
        print("🛑 Disconnected from MongoDB")


# ============================================
# UTILS
# ============================================
def save_base64_image(base64_str: str, hazard_id: str) -> Optional[str]:
    try:
        if "," in base64_str:
            base64_str = base64_str.split(",", 1)[1]
        data = base64.b64decode(base64_str)
        filename = f"hazard_{hazard_id}_{uuid.uuid4().hex}.jpg"
        filepath = UPLOAD_DIR / filename
        with open(filepath, "wb") as f:
            f.write(data)
        return f"/uploads/{filename}"
    except Exception as e:
        print("Image save error:", e)
        return None


# ============================================
# AUTH ROUTES
# ============================================
@app.post("/auth/signup")
async def signup(user: UserSignup):
    if await db.users.find_one({"email": user.email}):
        raise HTTPException(400, "Email already registered")
    if len(user.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")
    hashed = get_password_hash(user.password)
    result = await db.users.insert_one({
        "name": user.name,
        "email": user.email,
        "password": hashed,
        "created_at": datetime.utcnow()
    })
    token = create_access_token({"sub": str(result.inserted_id)})
    return {"token": token, "user": {"id": str(result.inserted_id), "name": user.name, "email": user.email}}

@app.post("/auth/login")
async def login(data: UserLogin):
    user = await db.users.find_one({"email": data.email})
    if not user or not verify_password(data.password, user["password"]):
        raise HTTPException(401, "Invalid credentials")
    token = create_access_token({"sub": str(user["_id"])})
    return {"token": token, "user": {"id": str(user["_id"]), "name": user["name"], "email": user["email"]}}


# ============================================
# JSON-BASED HAZARD REPORT
# ============================================
@app.post("/api/hazards/report")
async def report_hazard(hazard: HazardReport, current_user: dict = Depends(get_current_user)):
    """Report hazard using JSON + base64 image with deduplication logic"""
    try:
        hazard_id = str(uuid.uuid4())
        photo_url = save_base64_image(hazard.photo, hazard_id) if hazard.photo else None

        # Deduplication parameters
        MAX_DISTANCE_METERS = 50   # ~50m radius
        TIME_WINDOW_MINUTES = 2    # ignore duplicates within last 2 min

        # Find similar hazards nearby
        recent_time = datetime.utcnow() - timedelta(minutes=TIME_WINDOW_MINUTES)
        nearby_hazard = await db.hazards.find_one({
            "hazardType": hazard.hazardType,
            "createdAt": {"$gte": recent_time},
            "location": {
                "$nearSphere": {
                    "$geometry": {"type": "Point", "coordinates": [hazard.longitude, hazard.latitude]},
                    "$maxDistance": MAX_DISTANCE_METERS
                }
            }
        })

        if nearby_hazard:
            # ✅ Duplicate found → increment its reportCount and maybe mark verified
            await db.hazards.update_one(
                {"_id": nearby_hazard["_id"]},
                {"$inc": {"reportCount": 1},
                 "$set": {"lastReportedAt": datetime.utcnow()}}
            )

            # Optionally mark verified if multiple reports
            if nearby_hazard.get("reportCount", 1) + 1 >= 3:
                await db.hazards.update_one(
                    {"_id": nearby_hazard["_id"]},
                    {"$set": {"verified": True}}
                )

            print(f"✅ Duplicate hazard ignored (merged with {nearby_hazard['id']})")
            return {
                "success": True,
                "message": "Duplicate hazard merged",
                "hazard_id": nearby_hazard["id"],
                "photoUrl": nearby_hazard.get("photoUrl")
            }

        # No duplicate found → insert new
        hazard_doc = {
            "id": hazard_id,
            "latitude": hazard.latitude,
            "longitude": hazard.longitude,
            "location": {"type": "Point", "coordinates": [hazard.longitude, hazard.latitude]},
            "hazardType": hazard.hazardType,
            "description": hazard.description,
            "timestamp": hazard.timestamp,
            "photoUrl": photo_url,
            "reporter_id": str(current_user["_id"]),
            "reporter_name": current_user["name"],
            "createdAt": datetime.utcnow(),
            "verified": False,
            "reportCount": 1
        }

        await db.hazards.insert_one(hazard_doc)

        # ✅ Broadcast to nearby users via WebSocket
        await manager.broadcast_hazard_to_nearby(
            hazard_doc,
            {"latitude": hazard.latitude, "longitude": hazard.longitude}
        )

        return {"success": True, "hazard_id": hazard_id, "photoUrl": photo_url}

    except Exception as e:
        print("Hazard report error:", e)
        raise HTTPException(500, str(e))


# ============================================
# WEBSOCKET
# ============================================
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=1008)
        return

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        if not user_id:
            await websocket.close(code=1008)
            return
    except JWTError:
        await websocket.close(code=1008)
        return

    await manager.connect(websocket, user_id)
    try:
        while True:
            data = await websocket.receive_text()
            msg = json.loads(data)
            t = msg.get("type")
            p = msg.get("payload", {})

            if t == "location_update":
                lat, lon = p.get("latitude"), p.get("longitude")
                if lat and lon:
                    manager.update_user_location(user_id, lat, lon)
                    await db.user_locations.update_one(
                        {"user_id": user_id},
                        {"$set": {"latitude": lat, "longitude": lon,
                                  "location": {"type": "Point", "coordinates": [lon, lat]},
                                  "timestamp": datetime.utcnow()}},
                        upsert=True
                    )
                    await manager.send_personal_message({"type": "location_ack"}, user_id)

            elif t == "hazard_report":
                hazard_id = str(uuid.uuid4())
                lat, lon = p["latitude"], p["longitude"]

                MAX_DISTANCE_METERS = 50
                TIME_WINDOW_MINUTES = 2
                recent_time = datetime.utcnow() - timedelta(minutes=TIME_WINDOW_MINUTES)

                nearby = await db.hazards.find_one({
                    "hazardType": p["hazardType"],
                    "createdAt": {"$gte": recent_time},
                    "location": {
                        "$nearSphere": {
                            "$geometry": {"type": "Point", "coordinates": [lon, lat]},
                            "$maxDistance": MAX_DISTANCE_METERS
                        }
                    }
                })

                if nearby:
                    await db.hazards.update_one(
                        {"_id": nearby["_id"]},
                        {"$inc": {"reportCount": 1}, "$set": {"lastReportedAt": datetime.utcnow()}}
                    )
                    if nearby.get("reportCount", 1) + 1 >= 3:
                        await db.hazards.update_one(
                            {"_id": nearby["_id"]},
                            {"$set": {"verified": True}}
                        )
                    print(f"Duplicate hazard merged with {nearby['id']}")
                    await manager.send_personal_message(
                        {"type": "hazard_ack", "payload": {"hazard_id": nearby["id"], "merged": True}},
                        user_id
                    )
                    continue

                photo_url = save_base64_image(p.get("photo", ""), hazard_id) if p.get("photo") else None
                hazard_doc = {
                    "id": hazard_id,
                    "latitude": lat,
                    "longitude": lon,
                    "hazardType": p["hazardType"],
                    "description": p["description"],
                    "timestamp": p["timestamp"],
                    "photoUrl": photo_url,
                    "reporter_id": user_id,
                    "createdAt": datetime.utcnow(),
                    "reportCount": 1,
                    "verified": False,
                    "location": {"type": "Point", "coordinates": [lon, lat]}
                }

                await db.hazards.insert_one(hazard_doc)
                await manager.broadcast_hazard_to_nearby(hazard_doc, {"latitude": lat, "longitude": lon})
                await manager.send_personal_message({"type": "hazard_ack", "payload": {"hazard_id": hazard_id}}, user_id)

    except WebSocketDisconnect:
        manager.disconnect(user_id)
    except Exception as e:
        print("WebSocket error:", e)
        manager.disconnect(user_id)


# ============================================
# STATS
# ============================================
@app.get("/api/stats")
async def get_statistics(current_user: dict = Depends(get_current_user)):
    total_hazards = await db.hazards.count_documents({})
    total_users = await db.users.count_documents({})
    active_users = len(manager.active_connections)
    return {
        "total_hazards": total_hazards,
        "total_users": total_users,
        "active_users": active_users,
    }


# ============================================
# ENTRYPOINT
# ============================================
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
