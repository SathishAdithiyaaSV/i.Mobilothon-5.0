import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  StatusBar,
  SafeAreaView,
  Vibration,
} from 'react-native';
import { Camera, useCameraDevices } from 'react-native-vision-camera';

export default function CameraScreen({ navigation }) {
  const [hasPermission, setHasPermission] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [detectedHazards, setDetectedHazards] = useState([]);
  const [isScanning, setIsScanning] = useState(false);
  const camera = useRef(null);
  const devices = useCameraDevices();
  const device = devices[0];

  useEffect(() => {
    console.log(devices);
    console.log(device);
    checkPermissions();
    
    // Simulate hazard detection every 3 seconds
    const interval = setInterval(() => {
      if (isScanning) {
        simulateHazardDetection();
      }
    }, 3000);

    return () => {
      clearInterval(interval);
      setIsActive(false);
    };
  }, [isScanning]);

  const checkPermissions = async () => {
    const cameraPermission = await Camera.requestCameraPermission();
    console.log(cameraPermission);
    setHasPermission(cameraPermission === 'granted');
  };

  const simulateHazardDetection = () => {
    const hazards = [
      '⚠️ Pothole detected',
      '🚧 Road construction ahead',
      '💧 Wet road surface',
      '🚗 Stopped vehicle',
      '🦌 Animal crossing',
    ];
    
    const randomHazard = hazards[Math.floor(Math.random() * hazards.length)];
    
    setDetectedHazards(prev => [
      { id: Date.now(), text: randomHazard, timestamp: new Date() },
      ...prev.slice(0, 4)
    ]);
    
    Vibration.vibrate(200);
    sendNotificationToNearbyDrivers(randomHazard);
  };

  const sendNotificationToNearbyDrivers = (hazard) => {
    // In production, this would send to a backend API
    console.log(`Sending notification: ${hazard}`);
    // Show toast or notification that alert was sent
  };

  const toggleScanning = () => {
    setIsScanning(!isScanning);
  };

  if (!hasPermission) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionText}>
            Camera permission is required
          </Text>
          <TouchableOpacity
            style={styles.permissionButton}
            onPress={checkPermissions}
          >
            <Text style={styles.permissionButtonText}>Grant Permission</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (!device) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.permissionContainer}>
          <Text style={styles.permissionText}>Loading camera...</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      
      <Camera
        ref={camera}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isActive}
        photo={false}
        video={false}
      />

      <View style={styles.overlay}>
        <View style={styles.topBar}>
          <View style={[styles.statusBadge, isScanning && styles.statusBadgeActive]}>
            <View style={[styles.statusDot, isScanning && styles.statusDotActive]} />
            <Text style={styles.statusText}>
              {isScanning ? 'Scanning' : 'Paused'}
            </Text>
          </View>
        </View>

        <View style={styles.hazardList}>
          {detectedHazards.map((hazard) => (
            <View key={hazard.id} style={styles.hazardItem}>
              <Text style={styles.hazardText}>{hazard.text}</Text>
              <Text style={styles.hazardTime}>
                {hazard.timestamp.toLocaleTimeString()}
              </Text>
            </View>
          ))}
          {detectedHazards.length === 0 && (
            <Text style={styles.noHazardsText}>
              {isScanning ? 'Monitoring road conditions...' : 'Tap Start to begin scanning'}
            </Text>
          )}
        </View>

        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={[styles.scanButton, isScanning && styles.scanButtonActive]}
            onPress={toggleScanning}
            activeOpacity={0.8}
          >
            <Text style={styles.scanButtonText}>
              {isScanning ? 'Stop Scanning' : 'Start Scanning'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#0a0a0a',
  },
  permissionText: {
    color: '#ffffff',
    fontSize: 18,
    textAlign: 'center',
    marginBottom: 20,
  },
  permissionButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 10,
  },
  permissionButtonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  overlay: {
    flex: 1,
    justifyContent: 'space-between',
  },
  topBar: {
    padding: 20,
    alignItems: 'flex-start',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 8,
  },
  statusBadgeActive: {
    backgroundColor: 'rgba(76, 175, 80, 0.3)',
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#666666',
  },
  statusDotActive: {
    backgroundColor: '#4CAF50',
  },
  statusText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  hazardList: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    gap: 10,
  },
  hazardItem: {
    backgroundColor: 'rgba(255, 59, 48, 0.9)',
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
  },
  hazardText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  hazardTime: {
    color: '#ffffff',
    fontSize: 12,
    opacity: 0.8,
  },
  noHazardsText: {
    color: '#ffffff',
    fontSize: 16,
    textAlign: 'center',
    opacity: 0.6,
  },
  bottomBar: {
    padding: 20,
    alignItems: 'center',
  },
  scanButton: {
    backgroundColor: '#4CAF50',
    paddingVertical: 18,
    paddingHorizontal: 50,
    borderRadius: 30,
    elevation: 5,
    shadowColor: '#4CAF50',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  scanButtonActive: {
    backgroundColor: '#f44336',
    shadowColor: '#f44336',
  },
  scanButtonText: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
});

// package.json dependencies needed:
/*
{
  "dependencies": {
    "react": "18.2.0",
    "react-native": "0.72.0",
    "@react-navigation/native": "^6.1.7",
    "@react-navigation/native-stack": "^6.9.13",
    "react-native-vision-camera": "^3.0.0",
    "react-native-safe-area-context": "^4.7.1",
    "react-native-screens": "^3.24.0"
  }
}
*/