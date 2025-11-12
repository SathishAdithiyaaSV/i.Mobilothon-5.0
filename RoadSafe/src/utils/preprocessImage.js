import ImageResizer from 'react-native-image-resizer';
import RNFS from 'react-native-fs';
import jpeg from 'jpeg-js'; // npm install jpeg-js
import { decode as atobPolyfill } from 'base-64'; // fallback if global.atob missing

export async function preprocessImage(photoPath) {
  try {
    // 1️⃣ Resize the image EXACTLY to 224x224 (no aspect ratio preservation)
    const resized = await ImageResizer.createResizedImage(
  photoPath,
  224,
  224,
  'JPEG',
  100,
  0,
  undefined,
  false, // 👈 This disables aspect ratio preservation
  { mode: 'stretch' } // 👈 Add this for some Android versions
);


    const resizedPath = resized.path; // always use .path, not .uri
    console.log('📸 Resized image path:', resizedPath);

    // 2️⃣ Read resized image file as base64
    const base64Data = await RNFS.readFile(resizedPath, 'base64');

    // 3️⃣ Convert base64 → binary Uint8Array
    const atobFn = typeof global.atob === 'function' ? global.atob : atobPolyfill;
    const binary = Uint8Array.from(atobFn(base64Data), c => c.charCodeAt(0));

    // 4️⃣ Decode JPEG to RGBA pixels
    const { data, width, height } = jpeg.decode(binary, { useTArray: true });
    console.log(`🧩 Decoded image size: ${width}x${height}`);

    // 5️⃣ Convert RGBA → normalized RGB (-1 to 1)
    const floatArray = new Float32Array(width * height * 3);
    for (let i = 0, j = 0; i < data.length; i += 4, j += 3) {
      floatArray[j]   = (data[i]   / 127.5) - 1.0; // R
      floatArray[j+1] = (data[i+1] / 127.5) - 1.0; // G
      floatArray[j+2] = (data[i+2] / 127.5) - 1.0; // B
    }

    // 6️⃣ Log tensor info
    console.log('✅ Preprocessed tensor ready');
    console.log('Tensor length:', floatArray.length); // should be 150528
    console.log('Min/Max (first 1k):',
      Math.min(...floatArray.slice(0, 1000)),
      Math.max(...floatArray.slice(0, 1000))
    );

    return floatArray; // ready for model.runSync([floatArray])
  } catch (err) {
    console.error('❌ preprocessImage failed:', err);
    throw err;
  }
}