import { VISION_TENSOR_SHAPE } from "./vision_tensor.js";

export function createVisionCnnBranch(tfRef, inputName="x_vision"){
  if(!tfRef) throw new Error("TensorFlow reference is required for the vision CNN branch");
  const input = tfRef.input({
    shape: [VISION_TENSOR_SHAPE.events, VISION_TENSOR_SHAPE.minutes, VISION_TENSOR_SHAPE.channels],
    name: inputName
  });
  let x = tfRef.layers.conv2d({ filters: 16, kernelSize: [3,3], activation: "relu", padding: "same" }).apply(input);
  x = tfRef.layers.maxPooling2d({ poolSize: [2,2] }).apply(x);
  x = tfRef.layers.conv2d({ filters: 32, kernelSize: [3,3], activation: "relu", padding: "same" }).apply(x);
  x = tfRef.layers.maxPooling2d({ poolSize: [2,2] }).apply(x);
  x = tfRef.layers.conv2d({ filters: 64, kernelSize: [3,3], activation: "relu", padding: "same" }).apply(x);
  x = tfRef.layers.flatten().apply(x);
  x = tfRef.layers.dense({ units: 64, activation: "relu" }).apply(x);
  const embedding = tfRef.layers.dropout({ rate: 0.3 }).apply(x);
  return { input, embedding };
}
