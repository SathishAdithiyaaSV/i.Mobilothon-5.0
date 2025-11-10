import React, { useState, useRef, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  StatusBar,
  SafeAreaView,
  Vibration,
  Image,
  Modal,
  ScrollView,
  Dimensions,
} from 'react-native';
import { Camera, useCameraDevices } from 'react-native-vision-camera';
import Geolocation from '@react-native-community/geolocation';
import RNFS from 'react-native-fs';
import { useTensorflowModel } from 'react-native-fast-tflite';

const API_BASE_URL = 'https://0c5e101966fb.ngrok-free.app';
const WS_URL = 'wss://0c5e101966fb.ngrok-free.app/ws';

export default function CameraScreen({ navigation }) {
  const [hasPermission, setHasPermission] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [detectedHazards, setDetectedHazards] = useState([]);
  const [receivedAlerts, setReceivedAlerts] = useState([]);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  
  const camera = useRef(null);
  const ws = useRef(null);
  const reconnectTimeout = useRef(null);
  const devices = useCameraDevices();
  const device = devices[0];

  const modelHook = useTensorflowModel(require('../../assets/models/model.tflite'));
  const model = modelHook.state === 'loaded' ? modelHook.model : null;


  useEffect(() => {
    console.log(devices);
    console.log(device);
    checkPermissions();
    getCurrentLocation();
    
    connectWebSocket();

    return () => {
      if (ws.current) {
        ws.current.close();
      }
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
      }
      setIsActive(false);
    };
  }, []);

  useEffect(() => {
    const locationInterval = setInterval(() => {
      getCurrentLocation();
    }, 10000);

    return () => clearInterval(locationInterval);
  }, []);

  useEffect(() => {
  if (!model || !camera.current) return;

  // Run AI detection every 5 seconds
  const interval = setInterval(async () => {
    try {
      console.log("Capturing");
      // Capture a frame
      const photo = await camera.current.takePhoto({
        qualityPrioritization: 'speed',
      });
      console.log("Captured");

      // Read the photo as bytes (convert to tensor input)
      const photoData = await RNFS.readFile(photo.path, 'base64');
      
      // TODO: preprocessImage(photoData) -> convert to Uint8Array or tensor input shape
      // This depends on your model input (e.g., 224x224 RGB).
      // For now, just mock detection logic to show integration:
      
      const mockOutput = 0.8; // fake model output
      if (mockOutput > 0.7) {
        onHazardDetectedByModel('pothole', 'AI Detected Pothole');
      }

    } catch (err) {
      console.error('AI detection error:', err);
    }
  }, 10000); // every 5s

  return () => clearInterval(interval);
}, [model, camera.current]);


  useEffect(() => {
    if (currentLocation && ws.current && ws.current.readyState === WebSocket.OPEN) {
      sendLocationUpdate(currentLocation);
    }
  }, [currentLocation]);

  const connectWebSocket = async () => {
    try {
      const token = await AsyncStorage.getItem('jwt_token');
      if (!token) {
        console.error('JWT token not found');
        return;
      }
      ws.current = new WebSocket(`${WS_URL}?token=${token}`);

      ws.current.onopen = () => {
        console.log('WebSocket connected');
        setWsConnected(true);
        
        if (currentLocation) {
          sendLocationUpdate(currentLocation);
        }
      };

      ws.current.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          handleWebSocketMessage(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      ws.current.onerror = (error) => {
        console.error('WebSocket error:', error);
        setWsConnected(false);
      };

      ws.current.onclose = (event) => {
        console.log('WebSocket closed:', event.code, event.reason);
        setWsConnected(false);
        
        reconnectTimeout.current = setTimeout(() => {
          console.log('Attempting to reconnect WebSocket...');
          connectWebSocket();
        }, 3000);
      };
    } catch (error) {
      console.error('Error creating WebSocket connection:', error);
      setWsConnected(false);
    }
  };

  const handleWebSocketMessage = (data) => {
    console.log('Received WebSocket message:', data);

    switch (data.type) {
      case 'hazard_alert':
        handleIncomingHazardAlert(data.payload);
        break;
      
      case 'location_ack':
        console.log('Location update acknowledged');
        break;
      
      case 'hazard_ack':
        console.log('Hazard report acknowledged:', data.payload);
        break;
      
      default:
        console.log('Unknown message type:', data.type);
    }
  };

  const handleIncomingHazardAlert = (alert) => {
    const alreadyExists = receivedAlerts.some(existing => existing.id === alert.id);
    
    if (!alreadyExists) {
      // Fetch the photo from backend if photoUrl is provided
      const newAlert = {
        id: alert.id || Date.now(),
        text: `${getHazardEmoji(alert.hazardType)} ${alert.description}`,
        timestamp: new Date(alert.timestamp),
        distance: alert.distance,
        type: 'received',
        hazardType: alert.hazardType,
        photoUri: alert.photoUrl ? `${API_BASE_URL}${alert.photoUrl}` : null,
        latitude: alert.latitude,
        longitude: alert.longitude,
      };

      setReceivedAlerts(prev => [newAlert, ...prev.slice(0, 9)]);

      Vibration.vibrate([0, 200, 100, 200]);
    }
  };

  const sendLocationUpdate = (location) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      const message = {
        type: 'location_update',
        payload: {
          latitude: location.latitude,
          longitude: location.longitude,
          timestamp: new Date().toISOString(),
        },
      };
      
      ws.current.send(JSON.stringify(message));
      console.log('Sent location update:', message);
    }
  };

  const sendHazardAlert = (hazardData) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      const message = {
        type: 'hazard_report',
        payload: hazardData,
      };
      
      ws.current.send(JSON.stringify(message));
      console.log('Sent hazard alert:', message);
      return true;
    } else {
      console.error('WebSocket not connected, cannot send hazard alert');
      return false;
    }
  };

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
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
    );
  };

  const reportHazard = async (hazardType, description) => {
  try {
    // Get current GPS location
    const position = await new Promise((resolve, reject) => {
      Geolocation.getCurrentPosition(
        (position) => {
          setCurrentLocation({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          });
          resolve(position);
        },
        (error) => {
          console.error('Error getting location:', error);
          reject(error);
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 }
      );
    });

    const currentLocation = {
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
    };

    if (!camera.current) {
      throw new Error('Camera not ready');
    }

    // Take photo
    const photo = await camera.current.takePhoto({
      qualityPrioritization: 'balanced',
      flash: 'off',
    });

    console.log('📸 Photo captured:', photo.path);

    // Prepare hazard data (no image yet)
    const hazardData = {
      latitude: currentLocation.latitude,
      longitude: currentLocation.longitude,
      hazardType: hazardType,
      description: description,
      timestamp: new Date().toISOString(),
    };

    // ✅ Send real-time hazard alert instantly (no image)
    const wsSent = sendHazardAlert(hazardData);

    // ✅ Upload photo separately to backend for persistence
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
    formData.append('timestamp', hazardData.timestamp);

    const photoBase64 = await RNFS.readFile(photo.path, 'base64');

    const token = await AsyncStorage.getItem('jwt_token');

    // Send to backend
    const response = await fetch(`${API_BASE_URL}/api/hazards/report`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,  // ✅ Add this line
      },
      body: JSON.stringify({
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        hazardType,
        description,
        timestamp: hazardData.timestamp,
        photo: `data:image/jpeg;base64,${photoBase64}`,
      }),
    });

    // ✅ Add to local detected hazards
    setDetectedHazards(prev => [
      {
        id: Date.now(),
        text: `${getHazardEmoji(hazardType)} ${description}`,
        timestamp: new Date(),
        type: 'detected',
        hazardType: hazardType,
        photoUri: `file://${photo.path}`,
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
      },
      ...prev.slice(0, 4),
    ]);

    // Vibrate and show success
    Vibration.vibrate(200);

    if (wsSent) {
      Alert.alert('✅ Success', 'Hazard alert sent to nearby drivers');
    } else {
      Alert.alert('⚠️ Partial Success', 'Photo saved, but alert may be delayed');
    }

  } catch (error) {
    console.error('❌ Error reporting hazard:', error);
    Alert.alert('Error', 'Failed to report hazard: ' + error.message);
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

  const onHazardDetectedByModel = (hazardType, description) => {
    reportHazard(hazardType, description);
  };

  const openAlertDetail = (alert) => {
    setSelectedAlert(alert);
    setModalVisible(true);
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
          <View style={styles.rightBadges}>
            {currentLocation && (
              <View style={styles.locationBadge}>
                <Text style={styles.locationText}>📍 GPS</Text>
              </View>
            )}
            <View style={[
              styles.wsBadge,
              wsConnected ? styles.wsConnected : styles.wsDisconnected
            ]}>
              <View style={[
                styles.wsDot,
                wsConnected ? styles.wsDotConnected : styles.wsDotDisconnected
              ]} />
              <Text style={styles.wsText}>
                {wsConnected ? 'Live' : 'Offline'}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.alertsContainer}>
          <Text style={styles.alertsTitle}>Recent Alerts</Text>
          <ScrollView 
            style={styles.alertsList}
            showsVerticalScrollIndicator={false}
          >
            {allAlerts.map((alert) => (
              <TouchableOpacity
                key={alert.id}
                onPress={() => openAlertDetail(alert)}
                activeOpacity={0.8}
              >
                <View 
                  style={[
                    styles.alertItem,
                    alert.type === 'detected' ? styles.alertDetected : styles.alertReceived
                  ]}
                >
                  <View style={styles.alertContent}>
                    {alert.photoUri && (
                      <Image
                        source={{ uri: alert.photoUri }}
                        style={styles.alertThumbnail}
                        resizeMode="cover"
                      />
                    )}
                    <View style={styles.alertTextContainer}>
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
                  </View>
                </View>
              </TouchableOpacity>
            ))}
            {allAlerts.length === 0 && (
              <Text style={styles.noAlertsText}>
                No alerts yet. Monitoring road conditions...
              </Text>
            )}
          </ScrollView>
        </View>

        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={styles.manualReportButton}
            onPress={async () => await reportHazard('pothole', 'Pothole detected')}
            activeOpacity={0.8}
          >
            {/* <Text style={styles.manualReportText}>🚨 Manual Report</Text> */}
          </TouchableOpacity>
        </View>
      </View>

      {/* Alert Detail Modal */}
      <Modal
        animationType="slide"
        transparent={true}
        visible={modalVisible}
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <TouchableOpacity
              style={styles.closeButton}
              onPress={() => setModalVisible(false)}
            >
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>

            {selectedAlert && (
              <ScrollView showsVerticalScrollIndicator={false}>
                <Text style={styles.modalTitle}>
                  {selectedAlert.text}
                </Text>

                {selectedAlert.photoUri && (
                  <Image
                    source={{ uri: selectedAlert.photoUri }}
                    style={styles.modalImage}
                    resizeMode="contain"
                  />
                )}

                <View style={styles.modalDetails}>
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Time:</Text>
                    <Text style={styles.detailValue}>
                      {selectedAlert.timestamp.toLocaleString()}
                    </Text>
                  </View>

                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Type:</Text>
                    <Text style={styles.detailValue}>
                      {selectedAlert.type === 'detected' ? 'Detected by you' : 'Received from nearby'}
                    </Text>
                  </View>

                  {selectedAlert.distance && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Distance:</Text>
                      <Text style={styles.detailValue}>
                        {Math.round(selectedAlert.distance)} meters away
                      </Text>
                    </View>
                  )}

                  {selectedAlert.latitude && selectedAlert.longitude && (
                    <View style={styles.detailRow}>
                      <Text style={styles.detailLabel}>Location:</Text>
                      <Text style={styles.detailValue}>
                        {selectedAlert.latitude.toFixed(6)}, {selectedAlert.longitude.toFixed(6)}
                      </Text>
                    </View>
                  )}
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
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
  rightBadges: {
    gap: 10,
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
  wsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 8,
  },
  wsConnected: {
    backgroundColor: 'rgba(76, 175, 80, 0.3)',
  },
  wsDisconnected: {
    backgroundColor: 'rgba(255, 59, 48, 0.3)',
  },
  wsDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  wsDotConnected: {
    backgroundColor: '#4CAF50',
  },
  wsDotDisconnected: {
    backgroundColor: '#ff3b30',
  },
  wsText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  alertsContainer: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingHorizontal: 20,
    paddingBottom: 20,
    maxHeight: 300,
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
    flex: 1,
  },
  alertItem: {
    padding: 12,
    borderRadius: 10,
    marginBottom: 10,
  },
  alertDetected: {
    backgroundColor: 'rgba(255, 59, 48, 0.9)',
  },
  alertReceived: {
    backgroundColor: 'rgba(255, 152, 0, 0.9)',
  },
  alertContent: {
    flexDirection: 'row',
    gap: 12,
  },
  alertThumbnail: {
    width: 60,
    height: 60,
    borderRadius: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.3)',
  },
  alertTextContainer: {
    flex: 1,
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
  backgroundColor: 'transparent',
  paddingVertical: 15,
  paddingHorizontal: 30,
  borderRadius: 25,
  elevation: 5,
  // shadowColor: '#ff3b30',
  // shadowOffset: { width: 0, height: 4 },
  // shadowOpacity: 0.3,
  // shadowRadius: 8,
},
  manualReportText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
  },
  modalContent: {
    width: '90%',
    maxHeight: '80%',
    backgroundColor: '#1a1a1a',
    borderRadius: 20,
    padding: 20,
  },
  closeButton: {
    alignSelf: 'flex-end',
    padding: 10,
  },
  closeButtonText: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  modalTitle: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
    textAlign: 'center',
  },
  modalImage: {
    width: '100%',
    height: 300,
    borderRadius: 10,
    marginBottom: 20,
    backgroundColor: '#000',
  },
  modalDetails: {
    gap: 15,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
  },
  detailLabel: {
    color: '#999',
    fontSize: 16,
    fontWeight: '600',
  },
  detailValue: {
    color: '#ffffff',
    fontSize: 16,
    flex: 1,
    textAlign: 'right',
  },
});