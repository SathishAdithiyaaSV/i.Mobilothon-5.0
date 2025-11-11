import ImageResizer from 'react-native-image-resizer';
import RNFS from 'react-native-fs';

/**
 * Preprocess image for TFLite model input
 * - Resize to 224x224
 * - Convert to Uint8Array or Float32Array
 */
export async function preprocessImage(photoPath, inputType = 'uint8') {
  try {
    // 1️⃣ Resize image to model's expected dimensions
    const resized = await ImageResizer.createResizedImage(
      photoPath,
      224,
      224,
      'JPEG',
      100
    );

    // 2️⃣ Read resized image as base64
    const base64Data = await RNFS.readFile(resized.uri, 'base64');

    // 3️⃣ Convert base64 → binary data manually (since Buffer isn't available)
    const binaryString = global.atob(base64Data); // decode base64 → binary string
    const len = binaryString.length;
    const uint8Array = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      uint8Array[i] = binaryString.charCodeAt(i);
    }

    // 4️⃣ Normalize to Float32Array if required
    if (inputType === 'float32') {
      const floatArray = new Float32Array(uint8Array.length);
      for (let i = 0; i < uint8Array.length; i++) {
        floatArray[i] = uint8Array[i] / 255.0;
      }
      return floatArray;
    }

    return uint8Array;
  } catch (err) {
    console.error('❌ preprocessImage failed:', err);
    throw err;
  }
}
