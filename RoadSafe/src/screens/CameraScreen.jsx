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
import Geolocation from '@react-native-community/geolocation';

const API_BASE_URL = 'https://your-api-endpoint.com'; // Replace with your actual API endpoint

export default function CameraScreen({ navigation }) {
  const [hasPermission, setHasPermission] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [detectedHazards, setDetectedHazards] = useState([]);
  const [receivedAlerts, setReceivedAlerts] = useState([]);
  const [currentLocation, setCurrentLocation] = useState(null);
  const camera = useRef(null);
  const devices = useCameraDevices();
  const device = devices[0];

  useEffect(() => {
    console.log(devices);
    console.log(device);
    checkPermissions();
    // getCurrentLocation();
    
    // Poll for nearby alerts every 5 seconds
    const alertInterval = setInterval(() => {
      fetchNearbyAlerts();
    }, 5000);

    return () => {
      clearInterval(alertInterval);
      setIsActive(false);
    };
  }, []);

  // Update location every 10 seconds
  useEffect(() => {
    const locationInterval = setInterval(() => {
      // getCurrentLocation();
    }, 10000);

    return () => clearInterval(locationInterval);
  }, []);

  const checkPermissions = async () => {
    const cameraPermission = await Camera.requestCameraPermission();
    console.log(cameraPermission);
    setHasPermission(cameraPermission === 'granted');
  };

  const getCurrentLocation = () => {
    Geolocation.getCurrentPosition(
      (position) => {
        setCurrentLocation({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        });
      },
      (error) => {
        console.error('Error getting location:', error);
        Alert.alert('Location Error', 'Unable to get current location');
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  };

  // Function to capture photo and send hazard to backend
  const reportHazard = async (hazardType, description) => {
    try {
      
    const position = await new Promise((resolve, reject) => {
      Geolocation.getCurrentPosition(
        (position) => {
          setCurrentLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
          resolve(position); // Return the position object
        },
        (error) => {
          console.error('Error getting location:', error);
          reject(error);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
      );
    });

    // Use the position from the Promise, not the state variable
    const currentLocation = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };

      if (!camera.current) {
        throw new Error('Camera not ready');
      }

      if (!currentLocation) {
        throw new Error('Location not available');
      }

      // Capture photo
      const photo = await camera.current.takePhoto({
        qualityPrioritization: 'balanced',
        flash: 'off',
      });

      // Prepare form data
      const formData = new FormData();
      formData.append('photo', {
        uri: photo.path,
        type: 'image/jpeg',
        name: `hazard_${Date.now()}.jpg`,
      });
      formData.append('latitude', currentLocation.latitude.toString());
      formData.append('longitude', currentLocation.longitude.toString());
      formData.append('hazardType', hazardType);
      formData.append('description', description);
      formData.append('timestamp', new Date().toISOString());

      // Send to backend
      const response = await fetch(`${API_BASE_URL}/api/hazards/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data',
        },
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const result = await response.json();
      console.log('Hazard reported successfully:', result);

      // Add to local detected hazards
      setDetectedHazards(prev => [
        {
          id: Date.now(),
          text: `${getHazardEmoji(hazardType)} ${description}`,
          timestamp: new Date(),
          type: 'detected',
        },
        ...prev.slice(0, 4)
      ]);

      Vibration.vibrate(200);

    } catch (error) {
      console.error('Error reporting hazard:', error);
      Alert.alert('Error', 'Failed to report hazard: ' + error.message);
    }
  };

  // Function to fetch alerts from nearby drivers
  const fetchNearbyAlerts = async () => {
    try {
      if (!currentLocation) {
        return;
      }

      const response = await fetch(
        `${API_BASE_URL}/api/hazards/nearby?latitude=${currentLocation.latitude}&longitude=${currentLocation.longitude}&radius=5000`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error(`API error: ${response.status}`);
      }

      const alerts = await response.json();
      
      // Filter out alerts we've already shown
      const newAlerts = alerts.filter(alert => 
        !receivedAlerts.some(existing => existing.id === alert.id)
      );

      if (newAlerts.length > 0) {
        // Add new alerts to the list
        setReceivedAlerts(prev => [
          ...newAlerts.map(alert => ({
            id: alert.id,
            text: `${getHazardEmoji(alert.hazardType)} ${alert.description}`,
            timestamp: new Date(alert.timestamp),
            distance: alert.distance,
            type: 'received',
          })),
          ...prev.slice(0, 9)
        ]);

        // Vibrate for new alerts
        Vibration.vibrate([0, 200, 100, 200]);
      }

    } catch (error) {
      console.error('Error fetching nearby alerts:', error);
    }
  };

  const getHazardEmoji = (hazardType) => {
    const emojiMap = {
      'pothole': '⚠️',
      'construction': '🚧',
      'wet_road': '💧',
      'stopped_vehicle': '🚗',
      'animal': '🦌',
      'accident': '🚨',
      'debris': '🪨',
    };
    return emojiMap[hazardType] || '⚠️';
  };

  // This function will be called by your ML model when a hazard is detected
  const onHazardDetectedByModel = (hazardType, description) => {
    reportHazard(hazardType, description);
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

  const allAlerts = [...detectedHazards, ...receivedAlerts].sort(
    (a, b) => b.timestamp - a.timestamp
  ).slice(0, 5);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      
      <Camera
        ref={camera}
        style={StyleSheet.absoluteFill}
        device={device}
        isActive={isActive}
        photo={true}
        video={false}
      />

      <View style={styles.overlay}>
        <View style={styles.topBar}>
          <View style={styles.statusBadge}>
            <View style={styles.statusDotActive} />
            <Text style={styles.statusText}>Monitoring</Text>
          </View>
          {currentLocation && (
            <View style={styles.locationBadge}>
              <Text style={styles.locationText}>📍 GPS Active</Text>
            </View>
          )}
        </View>

        <View style={styles.alertsContainer}>
          <Text style={styles.alertsTitle}>Recent Alerts</Text>
          <View style={styles.alertsList}>
            {allAlerts.map((alert) => (
              <View 
                key={alert.id} 
                style={[
                  styles.alertItem,
                  alert.type === 'detected' ? styles.alertDetected : styles.alertReceived
                ]}
              >
                <View style={styles.alertHeader}>
                  <Text style={styles.alertText}>{alert.text}</Text>
                  {alert.type === 'received' && alert.distance && (
                    <Text style={styles.distanceText}>
                      {Math.round(alert.distance)}m
                    </Text>
                  )}
                </View>
                <Text style={styles.alertTime}>
                  {alert.timestamp.toLocaleTimeString()}
                </Text>
                {alert.type === 'received' && (
                  <Text style={styles.alertSource}>From nearby driver</Text>
                )}
              </View>
            ))}
            {allAlerts.length === 0 && (
              <Text style={styles.noAlertsText}>
                No alerts yet. Monitoring road conditions...
              </Text>
            )}
          </View>
        </View>

        {/* Manual report button for testing */}
        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={styles.manualReportButton}
            onPress={() => reportHazard('pothole', 'Pothole detected')}
            activeOpacity={0.8}
          >
            <Text style={styles.manualReportText}>🚨 Manual Report</Text>
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
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(76, 175, 80, 0.3)',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 8,
  },
  statusDotActive: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#4CAF50',
  },
  statusText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  locationBadge: {
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 20,
  },
  locationText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  alertsContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingBottom: 20,
  },
  alertsTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: -1, height: 1 },
    textShadowRadius: 10,
  },
  alertsList: {
    gap: 10,
  },
  alertItem: {
    padding: 15,
    borderRadius: 10,
    marginBottom: 10,
  },
  alertDetected: {
    backgroundColor: 'rgba(255, 59, 48, 0.9)',
  },
  alertReceived: {
    backgroundColor: 'rgba(255, 152, 0, 0.9)',
  },
  alertHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 5,
  },
  alertText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
    flex: 1,
  },
  distanceText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 10,
  },
  alertTime: {
    color: '#ffffff',
    fontSize: 12,
    opacity: 0.8,
  },
  alertSource: {
    color: '#ffffff',
    fontSize: 11,
    opacity: 0.7,
    fontStyle: 'italic',
    marginTop: 2,
  },
  noAlertsText: {
    color: '#ffffff',
    fontSize: 16,
    textAlign: 'center',
    opacity: 0.6,
  },
  bottomBar: {
    padding: 20,
    alignItems: 'center',
  },
  manualReportButton: {
    backgroundColor: 'rgba(255, 59, 48, 0.8)',
    paddingVertical: 15,
    paddingHorizontal: 30,
    borderRadius: 25,
    elevation: 5,
    shadowColor: '#ff3b30',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  manualReportText: {
    color: '#ffffff',
    fontSize: 16,
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
    "react-native-screens": "^3.24.0",
    "@react-native-community/geolocation": "^3.0.6"
  }
}
*/