import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  SafeAreaView,
  Dimensions,
} from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation/AppNavigator';
import LinearGradient from 'react-native-linear-gradient';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

const { width } = Dimensions.get('window');

export default function HomeScreen({ navigation }: Props) {
  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000000" />
      
      {/* Background gradient */}
      <LinearGradient
        colors={['#000000', '#1a1a2e', '#16213e']}
        style={StyleSheet.absoluteFillObject}
      />
      
      <View style={styles.content}>
        {/* Header Section */}
        <View style={styles.header}>
          <View style={styles.logoContainer}>
            <View style={styles.logoCircle}>
              <Text style={styles.logo}>🛡️</Text>
            </View>
            <View style={styles.pulseCircle} />
          </View>
          
          <Text style={styles.title}>RoadSafe</Text>
          <Text style={styles.subtitle}>
            AI-Powered Hazard Detection
          </Text>
          <Text style={styles.description}>
            Keep your journey safe with real-time road hazard monitoring
          </Text>
        </View>

        {/* Feature Pills */}
        <View style={styles.featuresContainer}>
          <View style={styles.featurePill}>
            <Text style={styles.featureIcon}>🎯</Text>
            <Text style={styles.featureText}>Real-time Detection</Text>
          </View>
          <View style={styles.featurePill}>
            <Text style={styles.featureIcon}>🗺️</Text>
            <Text style={styles.featureText}>Live Map View</Text>
          </View>
          <View style={styles.featurePill}>
            <Text style={styles.featureIcon}>⚡</Text>
            <Text style={styles.featureText}>Instant Alerts</Text>
          </View>
        </View>

        {/* Start Button */}
        <TouchableOpacity
          style={styles.startButton}
          onPress={() => navigation.navigate('Camera')}
          activeOpacity={0.9}
        >
          <LinearGradient
            colors={['#00d4ff', '#0099cc']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.buttonGradient}
          >
            <View style={styles.buttonContent}>
              <Text style={styles.startButtonText}>Start Detection</Text>
              <View style={styles.buttonIconContainer}>
                <Text style={styles.startButtonIcon}>📸</Text>
              </View>
            </View>
          </LinearGradient>
        </TouchableOpacity>

        {/* Footer */}
        <View style={styles.footer}>
          <View style={styles.footerDivider} />
          <Text style={styles.footerText}>
            Point your camera at the road ahead
          </Text>
          <Text style={styles.footerSubtext}>
            AI will detect potholes, obstacles, and hazards
          </Text>
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
  content: {
    flex: 1,
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 30,
  },
  header: {
    alignItems: 'center',
    marginTop: 20,
  },
  logoContainer: {
    position: 'relative',
    marginBottom: 30,
  },
  logoCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(0, 212, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: 'rgba(0, 212, 255, 0.3)',
  },
  pulseCircle: {
    position: 'absolute',
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'transparent',
    borderWidth: 2,
    borderColor: 'rgba(0, 212, 255, 0.5)',
    top: 0,
    left: 0,
  },
  logo: {
    fontSize: 56,
  },
  title: {
    fontSize: 52,
    fontWeight: '800',
    color: '#ffffff',
    marginBottom: 8,
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#00d4ff',
    marginBottom: 12,
    letterSpacing: 0.5,
  },
  description: {
    fontSize: 15,
    color: '#9ca3af',
    textAlign: 'center',
    paddingHorizontal: 20,
    lineHeight: 22,
  },
  featuresContainer: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  featurePill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    gap: 8,
  },
  featureIcon: {
    fontSize: 16,
  },
  featureText: {
    color: '#d1d5db',
    fontSize: 13,
    fontWeight: '600',
  },
  startButton: {
    width: width - 48,
    borderRadius: 20,
    overflow: 'hidden',
    elevation: 8,
    shadowColor: '#00d4ff',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 16,
  },
  buttonGradient: {
    paddingVertical: 20,
    paddingHorizontal: 32,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  startButtonText: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  buttonIconContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 12,
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  startButtonIcon: {
    fontSize: 20,
  },
  footer: {
    alignItems: 'center',
    gap: 8,
  },
  footerDivider: {
    width: 60,
    height: 3,
    backgroundColor: 'rgba(0, 212, 255, 0.3)',
    borderRadius: 2,
    marginBottom: 12,
  },
  footerText: {
    color: '#9ca3af',
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'center',
  },
  footerSubtext: {
    color: '#6b7280',
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
});