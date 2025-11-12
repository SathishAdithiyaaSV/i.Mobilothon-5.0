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
import MapView, { Marker, Circle } from 'react-native-maps';
import { Camera, useCameraDevices } from 'react-native-vision-camera';
import Geolocation from '@react-native-community/geolocation';
import RNFS from 'react-native-fs';
import { useTensorflowModel } from 'react-native-fast-tflite';
import { preprocessImage } from '../utils/preprocessImage.js';

const API_BASE_URL = 'https://58db7ef748f9.ngrok-free.app';
const WS_URL = 'wss://58db7ef748f9.ngrok-free.app/ws';

// Utility: compute distance (in meters) between two coordinates
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const toRad = (deg) => deg * (Math.PI / 180);
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function MapScreen({ navigation }) {
  const [hasPermission, setHasPermission] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [detectedHazards, setDetectedHazards] = useState([]);
  const [receivedAlerts, setReceivedAlerts] = useState([]);
  const [currentLocation, setCurrentLocation] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [region, setRegion] = useState({
    latitude: 12.9716,
    longitude: 77.5946,
    latitudeDelta: 0.01,
    longitudeDelta: 0.01,
  });
  
  const camera = useRef(null);
  const mapRef = useRef(null);
  const ws = useRef(null);
  const lastDetectedHazards = useRef({});
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

    const interval = setInterval(async () => {
      try {
        if (!currentLocation) return; // skip if GPS not yet available

        console.log("Capturing...");
        const photo = await camera.current.takePhoto({
          qualityPrioritization: 'speed',
        });
        console.log("Captured");

        const inputTensor = await preprocessImage(photo.path, 'uint8');
        const outputs = model.runSync([inputTensor]);

        console.log(outputs);

        const mockOutput = 0.8; // replace with real model output later

        if (mockOutput > 0.7) {
          const hazardType = 'pothole';
          const now = Date.now();
          const cooldownMs = 20000; // 20 seconds
          const last = lastDetectedHazards.current[hazardType];

          // Prevent duplicate detection based on time + distance
          if (
            last &&
            now - last.timestamp < cooldownMs &&
            getDistance(
              last.latitude,
              last.longitude,
              currentLocation.latitude,
              currentLocation.longitude
            ) < 30 // within 30 meters
          ) {
            console.log(`⏸️ Skipping duplicate ${hazardType} detection`);
            return;
          }

          // Save last detection
          lastDetectedHazards.current[hazardType] = {
            timestamp: now,
            latitude: currentLocation.latitude,
            longitude: currentLocation.longitude,
          };

          console.log(`✅ New ${hazardType} detected and reported`);
          onHazardDetectedByModel(hazardType, 'AI Detected Pothole');
        }

      } catch (err) {
        console.error('AI detection error:', err);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [model, camera.current, currentLocation]);

  useEffect(() => {
    if (currentLocation && ws.current && ws.current.readyState === WebSocket.OPEN) {
      sendLocationUpdate(currentLocation);
    }
  }, [currentLocation]);

  useEffect(() => {
    if (currentLocation && mapRef.current) {
      mapRef.current.animateToRegion({
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        latitudeDelta: 0.01,
        longitudeDelta: 0.01,
      }, 1000);
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
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 10000 }
    );
  };

  const reportHazard = async (hazardType, description) => {
    try {
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
          { enableHighAccuracy: false, timeout: 15000, maximumAge: 10000 }
        );
      });

      const currentLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      };

      if (!camera.current) {
        throw new Error('Camera not ready');
      }

      const photo = await camera.current.takePhoto({
        qualityPrioritization: 'balanced',
        flash: 'off',
      });

      console.log('📸 Photo captured:', photo.path);

      const hazardData = {
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        hazardType: hazardType,
        description: description,
        timestamp: new Date().toISOString(),
      };

      const wsSent = sendHazardAlert(hazardData);

      const photoBase64 = await RNFS.readFile(photo.path, 'base64');

      const token = await AsyncStorage.getItem('jwt_token');

      const response = await fetch(`${API_BASE_URL}/api/hazards/report`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
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

  const getMarkerColor = (hazardType) => {
    const colorMap = {
      'pothole': '#FF3B30',
      'construction': '#FF9500',
      'wet_road': '#007AFF',
      'stopped_vehicle': '#FFCC00',
      'animal': '#34C759',
      'accident': '#FF2D55',
      'debris': '#8E8E93',
    };
    return colorMap[hazardType] || '#FF3B30';
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

  const allHazards = [...detectedHazards, ...receivedAlerts];

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" />
      
      {/* Background Camera - Hidden */}
      <View style={styles.hiddenCamera}>
        <Camera
          ref={camera}
          style={{ width: 1, height: 1 }}
          device={device}
          isActive={isActive}
          photo={true}
          video={false}
        />
      </View>

      {/* Map View - Uses default provider (Apple Maps on iOS, OpenStreetMap on Android) */}
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={region}
        showsUserLocation={true}
        showsMyLocationButton={true}
        followsUserLocation={true}
        showsCompass={true}
        showsTraffic={false}
        mapType="standard"
      >
        {/* Current Location Circle */}
        {currentLocation && (
          <Circle
            center={currentLocation}
            radius={50}
            fillColor="rgba(76, 175, 80, 0.2)"
            strokeColor="rgba(76, 175, 80, 0.8)"
            strokeWidth={2}
          />
        )}

        {/* Hazard Markers */}
        {allHazards.map((hazard) => (
          <Marker
            key={hazard.id}
            coordinate={{
              latitude: hazard.latitude,
              longitude: hazard.longitude,
            }}
            title={hazard.text}
            description={`${hazard.timestamp.toLocaleTimeString()}${hazard.distance ? ` - ${Math.round(hazard.distance)}m away` : ''}`}
            pinColor={getMarkerColor(hazard.hazardType)}
            onPress={() => openAlertDetail(hazard)}
          >
            <View style={[
              styles.markerContainer,
              hazard.type === 'detected' ? styles.markerDetected : styles.markerReceived
            ]}>
              <Text style={styles.markerEmoji}>{getHazardEmoji(hazard.hazardType)}</Text>
            </View>
          </Marker>
        ))}
      </MapView>

      {/* Top Status Bar */}
      <View style={styles.topBar}>
        <View style={styles.statusBadge}>
          <View style={styles.statusDotActive} />
          <Text style={styles.statusText}>AI Monitoring</Text>
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

      {/* Bottom Stats Bar */}
      <View style={styles.bottomStats}>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{detectedHazards.length}</Text>
          <Text style={styles.statLabel}>Detected</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{receivedAlerts.length}</Text>
          <Text style={styles.statLabel}>Received</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statNumber}>{allHazards.length}</Text>
          <Text style={styles.statLabel}>Total Alerts</Text>
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
    backgroundColor: '#ffffff',
  },
  hiddenCamera: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
  },
  map: {
    flex: 1,
  },
  permissionContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  permissionText: {
    color: '#333',
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
  topBar: {
    position: 'absolute',
    top: 10,
    left: 20,
    right: 20,
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
    backgroundColor: 'rgba(76, 175, 80, 0.95)',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  statusDotActive: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#ffffff',
  },
  statusText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  locationBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 15,
    paddingVertical: 10,
    borderRadius: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  locationText: {
    color: '#333',
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
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  wsConnected: {
    backgroundColor: 'rgba(76, 175, 80, 0.95)',
  },
  wsDisconnected: {
    backgroundColor: 'rgba(255, 59, 48, 0.95)',
  },
  wsDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  wsDotConnected: {
    backgroundColor: '#ffffff',
  },
  wsDotDisconnected: {
    backgroundColor: '#ffffff',
  },
  wsText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '600',
  },
  markerContainer: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#ffffff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 3,
    elevation: 5,
  },
  markerDetected: {
    backgroundColor: '#FF3B30',
  },
  markerReceived: {
    backgroundColor: '#FF9500',
  },
  markerEmoji: {
    fontSize: 20,
  },
  bottomStats: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 15,
    padding: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  statCard: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  statLabel: {
    fontSize: 12,
    color: '#666',
    marginTop: 5,
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
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 20,
  },
  closeButton: {
    alignSelf: 'flex-end',
    padding: 10,
  },
  closeButtonText: {
    color: '#333',
    fontSize: 24,
    fontWeight: 'bold',
  },
  modalTitle: {
    color: '#333',
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
    backgroundColor: '#f0f0f0',
  },
  modalDetails: {
    gap: 15,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0, 0, 0, 0.1)',
  },
  detailLabel: {
    color: '#666',
    fontSize: 16,
    fontWeight: '600',
  },
  detailValue: {
    color: '#333',
    fontSize: 16,
    flex: 1,
    textAlign: 'right',
  },
});