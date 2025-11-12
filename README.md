# 🚗 RoadSafe – Real-Time Road Hazard Detection System

> **AI-powered road safety platform** that detects, reports, and alerts nearby users about road hazards in real time using **FastAPI**, **MongoDB**, and **React Native**.

---

## Overview

**RoadSafe AI** transforms **any smartphone into a proactive, real-time road hazard detection device**, creating an **intelligent, crowd-sourced safety network**.
It fuses **AI-based visual detection** verified by user input, alerting nearby drivers and enhancing road safety across India.

---

## 🧠 Models Used

| Model                                         | Description                                                                                   | Framework                        |
| --------------------------------------------- | --------------------------------------------------------------------------------------------- | -------------------------------- |
| **RT-DETR (Real-Time Detection Transformer)** | Transformer-based object detection model for real-time hazard recognition on live camera feed | TensorFlow Lite / PyTorch Mobile |
| **MobileNet Transformer (optimized variant)** | Lightweight transformer backbone for mobile inference                                         | TensorFlow Lite                  |
| **Mediapipe (optional)**                      | Used for real-time blurring of faces and license plates                                       | On-device preprocessing          |

> ✅ The combination of **RT-DETR** and **MobileNet Transformer** enables highly accurate, real-time detection while preserving privacy through **on-device AI**.

---

## Features

### 📱 Mobile App (React Native)

* **AI-powered hazard detection** using TensorFlow Lite (RT-DETR).
* **Live map view** showing detected and received hazards.
* **Automatic photo capture** and base64 upload.
* **WebSocket communication** for real-time alerts.
* **Vibration + animated alerts** for nearby hazards.
* **Camera preview overlay** for visual feedback.

### ⚙️ Backend (FastAPI)

* **JWT Authentication** (`/auth/signup`, `/auth/login`)
* **Hazard Reporting API** (`/api/hazards/report`)
* **WebSocket endpoint** (`/ws`) for real-time updates
* **Duplicate hazard detection** (50m, 2-min rule)
* **Automatic merging of similar reports**
* **Static image serving** via `/uploads/`
* **MongoDB geospatial indexing** for proximity queries

---

## 🧩 Tech Stack

| Layer                  | Technology                                                    | Purpose                               |
| ---------------------- | ------------------------------------------------------------- | ------------------------------------- |
| **Frontend**           | React Native, VisionCamera, React Native Maps                 | Cross-platform mobile UI              |
| **AI Models**          | RT-DETR (Transformer), MobileNet Transformer, TensorFlow Lite | On-device hazard detection            |
| **Backend**            | FastAPI, Motor (Async MongoDB), WebSockets                    | Event processing & notifications      |
| **Database**           | MongoDB Atlas                                                 | Geo-spatial hazard storage            |
| **Hosting**            | Render / Google Cloud Run                                     | Scalable deployment                   |
| **Auth**               | JWT Tokens                                                    | Secure login and signup               |

---

## ⚙️ Backend Setup (FastAPI)

```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### Environment Variables

`.env`

```
MONGODB_URL=mongodb+srv://<username>:<password>@cluster.mongodb.net/
SECRET_KEY=your_secret_key
```

### Run Locally

```bash
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

---

## 📡 API Endpoints

| Method | Endpoint              | Description                |
| ------ | --------------------- | -------------------------- |
| `POST` | `/auth/signup`        | Register new user          |
| `POST` | `/auth/login`         | Login user (JWT)           |
| `POST` | `/api/hazards/report` | Report hazard with image   |
| `GET`  | `/api/stats`          | Get hazard and user stats  |
| `WS`   | `/ws`                 | WebSocket for live updates |

---

## 📱 Mobile App Setup (React Native)

```bash
cd app
npm install
```

Edit backend URLs in:

* `CameraScreen.jsx`
* `AuthScreen.jsx`

```js
const API_BASE_URL = 'https://<your-backend>.onrender.com';
const WS_URL = 'wss://<your-backend>.onrender.com/ws';
```

Add model in:

```
app/assets/models/model.tflite
```

Run the development server:

```bash
npx react-native start
```

Run the app on Android:

```bash
npx react-native run-android
```

---

## 🧠 AI Model Integration Example

```js
const modelHook = useTensorflowModel(require('../../assets/models/model.tflite'));
const model = modelHook.state === 'loaded' ? modelHook.model : null;

// Run inference
const outputs = model.runSync([inputTensor]);
```

The preprocessing pipeline ensures that images are resized to **224x224**, normalized between **[-1, 1]**, and converted into a tensor suitable for the model inference.

---

## 🗺️ Map Screen Highlights

✅ Real-time GPS tracking
✅ AI-driven hazard detection
✅ Color-coded hazard markers
✅ Vibration & animated alerts
✅ Modal with photo and details

---

## 🧠 Future Enhancements

* [x] **Firebase push notifications** for real-time alerts to nearby users.
* [x] **AWS S3 / Cloudinary integration** for scalable image storage.
* [x] **User reputation scoring system** to prioritize credible reports.
* [x] **Municipal dashboard with live heatmaps** for authorities.
* [x] **Enhanced Transformer optimization** for faster inference on edge devices.
* [x] **Offline hazard caching and sync** for low-connectivity regions.
* [x] **Multi-language support** for inclusivity across India.
* [x] **Integration with Google Maps Directions API** to reroute around hazards.
* [x] **Automatic model updates** through version-controlled OTA downloads.

---

## 🛡️ License

This project is licensed under the **MIT License**.
Feel free to use, modify, and build upon it!
