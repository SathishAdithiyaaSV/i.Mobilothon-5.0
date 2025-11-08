from fastapi import FastAPI, WebSocket, WebSocketDisconnect, UploadFile, File, Form, HTTPException, Depends, status
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

load_dotenv()

# Configuration
MONGODB_URL = os.getenv("MONGODB_URL")
DATABASE_NAME = "road_hazard_db"
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-in-production")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7  # 7 days
UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)

# Password hashing
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer()

# Pydantic models
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
    photo: Optional[str] = None  # base64 encoded


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


# Initialize FastAPI app
app = FastAPI(title="Road Hazard Detection API", version="1.0.0")

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount uploads directory
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")

# MongoDB client
mongodb_client: Optional[AsyncIOMotorClient] = None
db = None


# Helper functions for authentication
def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password: str) -> str:
    return pwd_context.hash(password)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.utcnow() + expires_delta
    else:
        expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt


async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    token = credentials.credentials
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id: str = payload.get("sub")
        if user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid authentication credentials"
            )
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials"
        )
    
    user = await db.users.find_one({"_id": ObjectId(user_id)})
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found"
        )
    return user


# WebSocket connection manager
class ConnectionManager:
    def __init__(self):
        self.active_connections: Dict[str, WebSocket] = {}
        self.user_locations: Dict[str, UserLocation] = {}

    async def connect(self, websocket: WebSocket, user_id: str):
        await websocket.accept()
        self.active_connections[user_id] = websocket
        print(f"User {user_id} connected. Total connections: {len(self.active_connections)}")

    def disconnect(self, user_id: str):
        if user_id in self.active_connections:
            del self.active_connections[user_id]
        if user_id in self.user_locations:
            del self.user_locations[user_id]
        print(f"User {user_id} disconnected. Total connections: {len(self.active_connections)}")

    async def send_personal_message(self, message: dict, user_id: str):
        if user_id in self.active_connections:
            try:
                await self.active_connections[user_id].send_json(message)
            except Exception as e:
                print(f"Error sending message to {user_id}: {e}")

    async def broadcast_hazard_to_nearby(self, hazard_data: dict, reporter_location: dict, radius_km: float = 5.0):
        """Broadcast hazard alert to users within specified radius"""
        reporter_lat = reporter_location["latitude"]
        reporter_lon = reporter_location["longitude"]
        
        notified_users = []
        for user_id, location in self.user_locations.items():
            # Skip the reporter
            if user_id == hazard_data.get("reporter_id"):
                continue
            
            # Calculate distance
            distance = self.calculate_distance(
                reporter_lat, reporter_lon,
                location.latitude, location.longitude
            )
            
            # Send alert if within radius
            if distance <= radius_km * 1000:  # Convert km to meters
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
        """Update user's location"""
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
        """Calculate distance between two coordinates in meters using Haversine formula"""
        R = 6371000  # Earth's radius in meters
        
        phi1 = math.radians(lat1)
        phi2 = math.radians(lat2)
        delta_phi = math.radians(lat2 - lat1)
        delta_lambda = math.radians(lon2 - lon1)
        
        a = math.sin(delta_phi/2)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda/2)**2
        c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
        
        return R * c


manager = ConnectionManager()


# Startup and shutdown events
@app.on_event("startup")
async def startup_db_client():
    global mongodb_client, db
    mongodb_client = AsyncIOMotorClient(MONGODB_URL)
    db = mongodb_client[DATABASE_NAME]
    
    # Create indexes
    await db.hazards.create_index([("location", "2dsphere")])
    await db.hazards.create_index([("timestamp", -1)])
    await db.user_locations.create_index([("location", "2dsphere")])
    await db.user_locations.create_index([("user_id", 1)])
    await db.users.create_index([("email", 1)], unique=True)
    
    print("Connected to MongoDB")


@app.on_event("shutdown")
async def shutdown_db_client():
    global mongodb_client
    if mongodb_client:
        mongodb_client.close()
        print("Disconnected from MongoDB")


# Helper functions
def save_base64_image(base64_str: str, hazard_id: str) -> str:
    """Save base64 encoded image and return file path"""
    try:
        # Remove data URL prefix if present
        if "," in base64_str:
            base64_str = base64_str.split(",")[1]
        
        # Decode base64
        image_data = base64.b64decode(base64_str)
        
        # Generate filename
        filename = f"hazard_{hazard_id}_{uuid.uuid4().hex}.jpg"
        filepath = UPLOAD_DIR / filename
        
        # Save file
        with open(filepath, "wb") as f:
            f.write(image_data)
        
        return f"/uploads/{filename}"
    except Exception as e:
        print(f"Error saving image: {e}")
        return None


# ============================================
# AUTHENTICATION ROUTES
# ============================================

@app.post("/auth/signup")
async def signup(user_data: UserSignup):
    """Create a new user account"""
    try:
        # Check if user already exists
        existing_user = await db.users.find_one({"email": user_data.email})
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered"
            )
        
        # Validate password length
        if len(user_data.password) < 6:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Password must be at least 6 characters long"
            )
        
        # Hash password
        hashed_password = get_password_hash(user_data.password)
        
        # Create user document
        user_doc = {
            "name": user_data.name,
            "email": user_data.email,
            "password": hashed_password,
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        }
        
        # Insert into database
        result = await db.users.insert_one(user_doc)
        user_id = str(result.inserted_id)
        
        # Create access token
        access_token = create_access_token(data={"sub": user_id})
        
        return {
            "token": access_token,
            "user": {
                "id": user_id,
                "name": user_data.name,
                "email": user_data.email
            }
        }
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"Signup error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to create account"
        )


@app.post("/auth/login")
async def login(user_data: UserLogin):
    """Login user and return JWT token"""
    try:
        # Find user by email
        user = await db.users.find_one({"email": user_data.email})
        if not user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password"
            )
        
        # Verify password
        if not verify_password(user_data.password, user["password"]):
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid email or password"
            )
        
        # Create access token
        user_id = str(user["_id"])
        access_token = create_access_token(data={"sub": user_id})
        
        return {
            "token": access_token,
            "user": {
                "id": user_id,
                "name": user["name"],
                "email": user["email"]
            }
        }
    
    except HTTPException:
        raise
    except Exception as e:
        print(f"Login error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Login failed"
        )


@app.get("/auth/me")
async def get_me(current_user: dict = Depends(get_current_user)):
    """Get current user profile"""
    return {
        "id": str(current_user["_id"]),
        "name": current_user["name"],
        "email": current_user["email"],
        "created_at": current_user["created_at"]
    }


@app.post("/auth/forgot-password")
async def forgot_password(email: EmailStr):
    """Request password reset (placeholder for now)"""
    # TODO: Implement password reset logic with email
    user = await db.users.find_one({"email": email})
    if not user:
        # Don't reveal if email exists for security
        return {"message": "If the email exists, a reset link will be sent"}
    
    # TODO: Generate reset token and send email
    return {"message": "If the email exists, a reset link will be sent"}


@app.put("/auth/profile")
async def update_profile(
    name: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Update user profile"""
    try:
        update_data = {"updated_at": datetime.utcnow()}
        if name:
            update_data["name"] = name
        
        await db.users.update_one(
            {"_id": current_user["_id"]},
            {"$set": update_data}
        )
        
        updated_user = await db.users.find_one({"_id": current_user["_id"]})
        
        return {
            "id": str(updated_user["_id"]),
            "name": updated_user["name"],
            "email": updated_user["email"],
            "created_at": updated_user["created_at"]
        }
    
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to update profile"
        )


# ============================================
# REST API ENDPOINTS
# ============================================

@app.get("/")
async def root():
    return {
        "message": "Road Hazard Detection API",
        "version": "1.0.0",
        "endpoints": {
            "websocket": "/ws/{user_id}",
            "auth": {
                "signup": "/auth/signup",
                "login": "/auth/login",
                "me": "/auth/me",
                "forgot_password": "/auth/forgot-password"
            },
            "hazards": {
                "report": "/api/hazards/report",
                "get_all": "/api/hazards",
                "nearby": "/api/hazards/nearby"
            }
        }
    }


@app.post("/api/hazards/report")
async def report_hazard(
    latitude: float = Form(...),
    longitude: float = Form(...),
    hazardType: str = Form(...),
    description: str = Form(...),
    timestamp: str = Form(...),
    photo: Optional[UploadFile] = File(None),
    current_user: dict = Depends(get_current_user)
):
    """Report a hazard via HTTP (for persistence) - Protected route"""
    try:
        hazard_id = str(uuid.uuid4())
        photo_url = None
        
        # Save uploaded photo
        if photo:
            filename = f"hazard_{hazard_id}_{photo.filename}"
            filepath = UPLOAD_DIR / filename
            
            with open(filepath, "wb") as f:
                content = await photo.read()
                f.write(content)
            
            photo_url = f"/uploads/{filename}"
        
        # Create hazard document
        hazard_doc = {
            "id": hazard_id,
            "latitude": latitude,
            "longitude": longitude,
            "location": {
                "type": "Point",
                "coordinates": [longitude, latitude]
            },
            "hazardType": hazardType,
            "description": description,
            "timestamp": timestamp,
            "photoUrl": photo_url,
            "reporter_id": str(current_user["_id"]),
            "reporter_name": current_user["name"],
            "createdAt": datetime.utcnow(),
            "verified": False,
            "reportCount": 1
        }
        
        # Insert into MongoDB
        result = await db.hazards.insert_one(hazard_doc)
        
        return JSONResponse({
            "success": True,
            "hazard_id": hazard_id,
            "message": "Hazard reported successfully"
        })
    
    except Exception as e:
        print(f"Error reporting hazard: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/hazards")
async def get_hazards(
    limit: int = 100,
    skip: int = 0,
    hazard_type: Optional[str] = None,
    current_user: dict = Depends(get_current_user)
):
    """Get all hazards with optional filtering - Protected route"""
    try:
        query = {}
        if hazard_type:
            query["hazardType"] = hazard_type
        
        cursor = db.hazards.find(query).sort("timestamp", -1).skip(skip).limit(limit)
        hazards = await cursor.to_list(length=limit)
        
        # Convert ObjectId to string
        for hazard in hazards:
            hazard["_id"] = str(hazard["_id"])
        
        return {"hazards": hazards, "count": len(hazards)}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/hazards/nearby")
async def get_nearby_hazards(
    latitude: float,
    longitude: float,
    radius_km: float = 5.0,
    limit: int = 50,
    current_user: dict = Depends(get_current_user)
):
    """Get hazards near a location - Protected route"""
    try:
        # MongoDB geospatial query
        query = {
            "location": {
                "$near": {
                    "$geometry": {
                        "type": "Point",
                        "coordinates": [longitude, latitude]
                    },
                    "$maxDistance": radius_km * 1000  # Convert to meters
                }
            }
        }
        
        cursor = db.hazards.find(query).limit(limit)
        hazards = await cursor.to_list(length=limit)
        
        # Convert ObjectId and calculate distances
        for hazard in hazards:
            hazard["_id"] = str(hazard["_id"])
            hazard_lat = hazard["latitude"]
            hazard_lon = hazard["longitude"]
            distance = manager.calculate_distance(latitude, longitude, hazard_lat, hazard_lon)
            hazard["distance"] = round(distance, 2)
        
        return {"hazards": hazards, "count": len(hazards)}
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/hazards/{hazard_id}")
async def delete_hazard(
    hazard_id: str,
    current_user: dict = Depends(get_current_user)
):
    """Delete a hazard (user can only delete their own hazards)"""
    try:
        # Find the hazard
        hazard = await db.hazards.find_one({"id": hazard_id})
        
        if not hazard:
            raise HTTPException(status_code=404, detail="Hazard not found")
        
        # Check if user is the reporter
        if hazard.get("reporter_id") != str(current_user["_id"]):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only delete your own hazards"
            )
        
        result = await db.hazards.delete_one({"id": hazard_id})
        
        return {"success": True, "message": "Hazard deleted"}
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ============================================
# WEBSOCKET ENDPOINT
# ============================================

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    token = websocket.query_params.get("token")
    print(token)
    if not token:
        await websocket.close(code=1008)  # Policy Violation
        return

    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        user_id = payload.get("sub")
        print(user_id)
        if not user_id:
            await websocket.close(code=1008)
            return
    except JWTError:
        await websocket.close(code=1008)
        return

    # ✅ Authentication successful
    await manager.connect(websocket, user_id)
    print(f"User {user_id} connected")
    
    try:
        while True:
            # Receive message from client
            data = await websocket.receive_text()
            message = json.loads(data)
            
            message_type = message.get("type")
            payload = message.get("payload", {})
            
            if message_type == "location_update":
                # Update user location
                latitude = payload.get("latitude")
                longitude = payload.get("longitude")
                
                if latitude and longitude:
                    manager.update_user_location(user_id, latitude, longitude)
                    
                    # Store in database
                    await db.user_locations.update_one(
                        {"user_id": user_id},
                        {
                            "$set": {
                                "latitude": latitude,
                                "longitude": longitude,
                                "location": {
                                    "type": "Point",
                                    "coordinates": [longitude, latitude]
                                },
                                "timestamp": datetime.utcnow()
                            }
                        },
                        upsert=True
                    )
                    
                    # Send acknowledgment
                    await manager.send_personal_message({
                        "type": "location_ack",
                        "payload": {"status": "received"}
                    }, user_id)
            
            elif message_type == "hazard_report":
                # Handle real-time hazard report
                hazard_id = str(uuid.uuid4())
                
                # Save photo if included
                photo_url = None
                if "photo" in payload:
                    photo_url = save_base64_image(payload["photo"], hazard_id)
                
                # Create hazard document
                hazard_doc = {
                    "id": hazard_id,
                    "latitude": payload["latitude"],
                    "longitude": payload["longitude"],
                    "location": {
                        "type": "Point",
                        "coordinates": [payload["longitude"], payload["latitude"]]
                    },
                    "hazardType": payload["hazardType"],
                    "description": payload["description"],
                    "timestamp": payload["timestamp"],
                    "photoUrl": photo_url,
                    "reporter_id": user_id,
                    "createdAt": datetime.utcnow(),
                    "verified": False,
                    "reportCount": 1
                }
                
                # Insert into MongoDB
                await db.hazards.insert_one(hazard_doc)
                
                # Broadcast to nearby users
                notified_users = await manager.broadcast_hazard_to_nearby(
                    hazard_doc,
                    {"latitude": payload["latitude"], "longitude": payload["longitude"]},
                    radius_km=5.0
                )
                
                # Send acknowledgment to reporter
                await manager.send_personal_message({
                    "type": "hazard_ack",
                    "payload": {
                        "hazard_id": hazard_id,
                        "notified_users": len(notified_users),
                        "status": "broadcasted"
                    }
                }, user_id)
    
    except WebSocketDisconnect:
        manager.disconnect(user_id)
    except Exception as e:
        print(f"WebSocket error for user {user_id}: {e}")
        manager.disconnect(user_id)


@app.get("/api/stats")
async def get_statistics(current_user: dict = Depends(get_current_user)):
    """Get system statistics - Protected route"""
    try:
        total_hazards = await db.hazards.count_documents({})
        total_users = await db.users.count_documents({})
        active_users = len(manager.active_connections)
        
        # Get hazards by type
        pipeline = [
            {"$group": {"_id": "$hazardType", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}}
        ]
        hazards_by_type = await db.hazards.aggregate(pipeline).to_list(length=100)
        
        # Get user's reported hazards
        user_hazards = await db.hazards.count_documents({
            "reporter_id": str(current_user["_id"])
        })
        
        return {
            "total_hazards": total_hazards,
            "total_users": total_users,
            "active_users": active_users,
            "user_hazards": user_hazards,
            "hazards_by_type": hazards_by_type
        }
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)