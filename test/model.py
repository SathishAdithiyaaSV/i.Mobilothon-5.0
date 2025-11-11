import tensorflow as tf
import numpy as np
from tensorflow import keras

# Define class count (same as your app)
num_classes = 5

# Simple CNN for demonstration
model = keras.Sequential([
    keras.layers.Input(shape=(224, 224, 3)),
    keras.layers.Conv2D(8, 3, activation='relu'),
    keras.layers.MaxPooling2D(),
    keras.layers.Flatten(),
    keras.layers.Dense(num_classes, activation='softmax')
])

# Compile the model (not actually training)
model.compile(optimizer='adam', loss='categorical_crossentropy')

# Convert to TFLite
converter = tf.lite.TFLiteConverter.from_keras_model(model)
tflite_model = converter.convert()

# Save the .tflite file
with open("model.tflite", "wb") as f:
    f.write(tflite_model)

print("✅ model.tflite saved successfully!")
