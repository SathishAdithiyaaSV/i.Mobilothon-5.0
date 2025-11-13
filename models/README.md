## About Datasets
We used datasets from Kaggle and Roboflow to train our Transformer based models.
## About Model
This project implements a Vision Transformer (ViT) for binary road hazard detection, distinguishing between normal road conditions and hazardous situations (potholes, cracks, etc.).
Architecture Highlights
Pure Transformer Design

Input: 224×224 RGB images divided into 16×16 patches (196 total patches)
Patch Encoding: Linear projection + learnable position embeddings
Transformer Blocks: 8 layers with multi-head self-attention (8 heads, 256-dim embeddings)
Classification Head: Global average pooling → Dense layers → Softmax (2 classes)

Key Components

Patch Embedding: Converts image patches to vector sequences for transformer processing
Multi-Head Attention: Captures global spatial relationships across the entire image
MLP Blocks: GELU activation with residual connections for feature refinement
Layer Normalization: Stabilizes training with pre-norm architecture

Technical Specifications

Parameters: ~5-8M (lightweight for edge deployment)
Input Size: 224×224×3 (RGB)
Patch Size: 16×16
Projection Dim: 256
Optimizer: AdamW with cosine decay
Training: 30 epochs with augmentation (flips, brightness, contrast, rotation)

Advantages over CNNs
✅ Global context: Self-attention captures long-range dependencies from the start
✅ Position-aware: Explicit position embeddings encode spatial information
✅ Scalable: Transformer architecture proven to scale well with data
✅ Interpretable: Attention maps can visualize what the model focuses on
Deployment

TFLite Models: Float32 and INT8 quantized versions available
Edge-Ready: Optimized for mobile and embedded systems
Inference: ~50-100ms on modern mobile GPUs

Performance

Accuracy: >90% on test set
Precision/Recall: Balanced for both hazard detection and false positive reduction
Model Size: <10MB (TFLite), <5MB (INT8 quantized)
