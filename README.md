APO Technology 

APO Technology is a BCI startup dedicated to making neural signals actionable. We build pipelines that capture, process, and interpret EEG data in real time—translating complex brain activity into hands-free commands for digital interfaces and automation.

[**View Live Prototype**](https://s4lomon.github.io/ubiquotous/) | [**Documentation**](https://github.com/s4lomon/ubiquotous)

---

## Core Projects

### 1. The Neural Sphere (Real-Time Color Map)
A visual biofeedback engine that maps raw EEG data into a dynamic 3D RGB color system. 
* **Current State:** Visualizes brain state shifts through color-space interpolation.
* **Version 2.0 (In Development):** Moving beyond visualization to **Movement Intention Detection**. This version focuses on decoding motor imagery to generate low-latency machine commands.

### 2. BESA Bridge (Research-Grade Simulation)
A high-performance **C++ bridge** designed to facilitate the transition from consumer hardware to professional research systems.
* **Function:** Bridges **LSL (Lab Streaming Layer)** to **WebSockets**.
* **Use Case:** Currently used to simulate a **BioSemi ActiveTwo (128-channel)** environment, allowing for the development of high-density signal processing pipelines without the physical hardware.

### 3. Gesture Dice Game
A hybrid control experiment bridging computer vision and neural input.
* **Function:** Controls a digital dice roller using hand gestures.
* **Roadmap:** Transitioning from webcam-based hand tracking to pure EEG-based motor intention triggers.

---

## Tech Stack
* **Languages:** C++, JavaScript (ES6+), Python
* **Protocols:** LSL (Lab Streaming Layer), WebBluetooth, WebSockets
* **Hardware Compatibility:** Muse Athena
* **Frontend:** WebGL / Three.js (for neural mapping)

---

## Ecosystem & Support
APO Technology is developed with the support of:
* **EDC Incubateur Paris:** Business strategy and startup scaling.
* **CogLab Paris:** Cognitive science mentorship and neuro-modeling resources.

---

## Contact
**Leticia Salomon** – Developer
* **LinkedIn:** [linkedin.com/in/leticia-salomon](https://www.linkedin.com/in/leticia-salomon-959578309)
* **GitHub:** [@s4lomon](https://github.com/s4lomon)

---
> *Disclaimer: This project is currently in the prototype/research phase. The BESA Bridge is intended for simulation and testing of high-density EEG pipelines.*
