import React, { useEffect, useRef, useState } from 'react';
import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { X, Hand, Upload, RotateCcw, AlertTriangle, Trash2, Sparkles, HardDrive, UserCheck } from 'lucide-react';
import {
  PRESET_MODELS,
  saveCustomModelToIndexedDB,
  getCustomModelFromIndexedDB,
  clearCustomModelFromIndexedDB,
  saveActiveModelPreference,
  getActiveModelPreference
} from '../utils/modelStorage';

export const HandControlMode: React.FC<{
  authToken?: string | null;
  onClose: () => void;
}> = ({ authToken, onClose }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const threeMountRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [status, setStatus] = useState<string>('Initializing Hand Tracking...');
  const [loadedModelName, setLoadedModelName] = useState<string>('Holographic Core (Default)');
  const [loadedModelType, setLoadedModelType] = useState<'default' | 'preset' | 'custom'>('default');
  const [modelError, setModelError] = useState<string | null>(null);
  const [isMobilePanelMinimized, setIsMobilePanelMinimized] = useState<boolean>(false);
  
  // Model state variables (using refs to access inside requestAnimationFrame)
  const rotationRef = useRef({ x: 0, y: 0 });
  const scaleRef = useRef<number>(1);
  const spinVelocityRef = useRef<number>(0);
  const lastWristPos = useRef<{ x: number; y: number; time: number } | null>(null);
  const wristHistoryRef = useRef<Array<{ x: number; time: number }>>([]);

  // Expose methods from inside the THREE.js closure
  const loadModelRef = useRef<(url: string, name: string, type: 'preset' | 'custom') => void>();
  const resetToPlaceholderRef = useRef<() => void>();
  const resetTransformRef = useRef<() => void>();

  useEffect(() => {
    let active = true;
    let handLandmarker: HandLandmarker | null = null;
    let mediaStream: MediaStream | null = null;
    let animationFrameId: number;

    // --- THREE.JS SETUP ---
    const container = threeMountRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.z = 6;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // Lighting (required for GLTF models)
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambientLight);
    
    const dirLight1 = new THREE.DirectionalLight(0xffffff, 2.0);
    dirLight1.position.set(5, 5, 5);
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x00f0ff, 1.5);
    dirLight2.position.set(-5, -5, -5);
    scene.add(dirLight2);

    const masterGroup = new THREE.Group();
    scene.add(masterGroup);

    let currentModelMesh: THREE.Object3D | null = null;
    let placeholderInnerModel: THREE.Mesh | null = null;

    const createPlaceholder = () => {
      const g = new THREE.Group();
      const geometry = new THREE.IcosahedronGeometry(1.5, 2);
      const material = new THREE.MeshBasicMaterial({
        color: 0x00f0ff,
        wireframe: true,
        transparent: true,
        opacity: 0.6,
        blending: THREE.AdditiveBlending
      });
      g.add(new THREE.Mesh(geometry, material));

      const innerGeo = new THREE.IcosahedronGeometry(0.8, 1);
      const innerMat = new THREE.MeshBasicMaterial({
        color: 0x00ffcc,
        wireframe: true,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending
      });
      placeholderInnerModel = new THREE.Mesh(innerGeo, innerMat);
      g.add(placeholderInnerModel);
      return g;
    };

    currentModelMesh = createPlaceholder();
    masterGroup.add(currentModelMesh);

    const gltfLoader = new GLTFLoader();

    loadModelRef.current = (url: string, name: string, type: 'preset' | 'custom') => {
      if (!active) return;
      setStatus(`Loading ${name}...`);
      setModelError(null);

      gltfLoader.load(
        url,
        (gltf) => {
          if (!active) return;
          if (currentModelMesh) {
            masterGroup.remove(currentModelMesh);
            placeholderInnerModel = null;
          }

          const newModel = gltf.scene;

          // Auto-center and Auto-scale
          const box = new THREE.Box3().setFromObject(newModel);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());

          const maxDim = Math.max(size.x, size.y, size.z);
          const targetSize = 3;
          const scale = maxDim > 0 ? targetSize / maxDim : 1;

          newModel.scale.setScalar(scale);
          newModel.position.sub(center.multiplyScalar(scale));

          const wrapper = new THREE.Group();
          wrapper.add(newModel);

          masterGroup.add(wrapper);
          currentModelMesh = wrapper;
          
          setLoadedModelName(name);
          setLoadedModelType(type);
          setStatus('Active');
          
          if (resetTransformRef.current) {
            resetTransformRef.current();
          }
        },
        undefined,
        (error) => {
          console.error("GLTF Load Error:", error);
          if (!active) return;
          setModelError(`Failed to load 3D model (${name}). File may be corrupted or in an unsupported format.`);
          setStatus('Active');
        }
      );
    };

    resetToPlaceholderRef.current = () => {
      if (currentModelMesh) {
        masterGroup.remove(currentModelMesh);
      }
      currentModelMesh = createPlaceholder();
      masterGroup.add(currentModelMesh);
      setLoadedModelName('Holographic Core (Default)');
      setLoadedModelType('default');
      setModelError(null);
      if (resetTransformRef.current) {
        resetTransformRef.current();
      }
    };

    resetTransformRef.current = () => {
      rotationRef.current = { x: 0, y: 0 };
      scaleRef.current = 1;
      spinVelocityRef.current = 0;
      masterGroup.rotation.set(0, 0, 0);
      masterGroup.scale.set(1, 1, 1);
    };

    // Auto-restore saved model preference on load
    const restoreSavedModel = async () => {
      try {
        const pref = await getActiveModelPreference(authToken);
        if (!active) return;

        if (pref && pref.type === 'preset' && pref.presetId) {
          const preset = PRESET_MODELS[pref.presetId];
          if (preset && loadModelRef.current) {
            loadModelRef.current(preset.url, preset.name, 'preset');
            return;
          }
        } else if (pref && pref.type === 'custom') {
          const savedCustom = await getCustomModelFromIndexedDB();
          if (!active) return;
          if (savedCustom && loadModelRef.current) {
            loadModelRef.current(savedCustom.url, savedCustom.name, 'custom');
            return;
          }
        }
      } catch (err) {
        console.warn('[HandControlMode] Could not restore saved model:', err);
      }
    };

    restoreSavedModel();

    const animateThree = () => {
      animationFrameId = requestAnimationFrame(animateThree);
      
      // Apply momentum spin velocity if active
      if (Math.abs(spinVelocityRef.current) > 0.0001) {
        rotationRef.current.y += spinVelocityRef.current;
        // Friction / damping factor (0.975 for silky deceleration)
        spinVelocityRef.current *= 0.975;
        if (Math.abs(spinVelocityRef.current) <= 0.0001) {
          spinVelocityRef.current = 0;
        }
      }

      // Apply smoothing to rotation and scale
      masterGroup.rotation.x += (rotationRef.current.x - masterGroup.rotation.x) * 0.15;
      masterGroup.rotation.y += (rotationRef.current.y - masterGroup.rotation.y) * 0.15;
      
      const targetScale = scaleRef.current;
      masterGroup.scale.x += (targetScale - masterGroup.scale.x) * 0.15;
      masterGroup.scale.y += (targetScale - masterGroup.scale.y) * 0.15;
      masterGroup.scale.z += (targetScale - masterGroup.scale.z) * 0.15;

      // Auto-rotation for placeholder inner model (if active)
      if (placeholderInnerModel) {
        placeholderInnerModel.rotation.y -= 0.01;
        placeholderInnerModel.rotation.x += 0.005;
      }

      renderer.render(scene, camera);
    };
    animateThree();

    const handleResize = () => {
      if (!container) return;
      if (container.clientHeight === 0) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    
    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(container);

    // --- MEDIAPIPE HANDS SETUP ---
    const initMediaPipe = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
        );
        handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: `https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`,
            delegate: "GPU"
          },
          runningMode: "VIDEO",
          numHands: 1
        });
        
        if (!active) return;

        mediaStream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 } });
        if (!active) {
          mediaStream.getTracks().forEach(track => track.stop());
          return;
        }

        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          videoRef.current.onloadedmetadata = () => {
            videoRef.current?.play();
            setStatus('Active');
            predictWebcam();
          };
        }
      } catch (err: any) {
        setStatus('Camera Error: ' + err.message);
        console.error("HandControlMode init error:", err);
      }
    };

    let lastVideoTime = -1;
    let openPalmFrames = 0;

    const predictWebcam = () => {
      if (!active || !videoRef.current || !canvasRef.current || !handLandmarker) return;
      
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const now = performance.now();

      if (video.readyState >= 2 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
        }

        const results = handLandmarker.detectForVideo(video, now);
        
        ctx.save();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        if (results.landmarks && results.landmarks.length > 0) {
          const landmarks = results.landmarks[0];
          
          ctx.strokeStyle = 'rgba(0, 240, 255, 0.5)';
          ctx.fillStyle = '#00f0ff';
          ctx.lineWidth = 1;

          const connect = (p1: number, p2: number) => {
            ctx.beginPath();
            ctx.moveTo(landmarks[p1].x * canvas.width, landmarks[p1].y * canvas.height);
            ctx.lineTo(landmarks[p2].x * canvas.width, landmarks[p2].y * canvas.height);
            ctx.stroke();
          };

          connect(0, 1); connect(1, 2); connect(2, 3); connect(3, 4); // Thumb
          connect(0, 5); connect(5, 6); connect(6, 7); connect(7, 8); // Index
          connect(5, 9); connect(9, 10); connect(10, 11); connect(11, 12); // Middle
          connect(9, 13); connect(13, 14); connect(14, 15); connect(15, 16); // Ring
          connect(13, 17); connect(0, 17); connect(17, 18); connect(18, 19); connect(19, 20); // Pinky

          landmarks.forEach((point, index) => {
            ctx.beginPath();
            ctx.arc(point.x * canvas.width, point.y * canvas.height, index === 4 || index === 8 ? 4 : 2, 0, 2 * Math.PI);
            ctx.fill();
          });

          const wrist = landmarks[0];
          const thumbTip = landmarks[4];
          const indexTip = landmarks[8];
          const pinkyTip = landmarks[20];

          if (wrist) {
            // Track history for velocity calculation
            wristHistoryRef.current.push({ x: wrist.x, time: now });
            // Keep window of last 150ms
            wristHistoryRef.current = wristHistoryRef.current.filter(item => now - item.time <= 150);

            if (lastWristPos.current) {
              const dx = wrist.x - lastWristPos.current.x;
              const dy = wrist.y - lastWristPos.current.y;
              const dt = Math.max(1, now - lastWristPos.current.time);
              const vx = dx / dt; // normalized coordinates / ms

              // Check for rapid swipe / flick gesture
              if (Math.abs(vx) > 0.0008 && Math.abs(dx) > 0.02) {
                // Flick detected! Impart angular momentum
                // Scale factor converts velocity to angular velocity (rad/frame)
                const angularImpulse = dx * 3.5;
                spinVelocityRef.current = Math.max(-0.3, Math.min(0.3, angularImpulse));
              } else {
                // Direct continuous tracking - smoothly interrupt any prior spin
                if (Math.abs(spinVelocityRef.current) > 0.01) {
                  spinVelocityRef.current *= 0.5;
                }
                rotationRef.current.y += dx * 6; 
                rotationRef.current.x += dy * 6;
              }
            }
            lastWristPos.current = { x: wrist.x, y: wrist.y, time: now };
          }

          if (thumbTip && indexTip && pinkyTip && wrist) {
            const pinchDist = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
            const spreadDist = Math.hypot(thumbTip.x - pinkyTip.x, thumbTip.y - pinkyTip.y);
            const indexWristDist = Math.hypot(indexTip.x - wrist.x, indexTip.y - wrist.y);

            // Open palm detection: fingers spread and extended, held relatively still (not swiping)
            const isStationary = lastWristPos.current ? Math.abs(wrist.x - lastWristPos.current.x) < 0.015 : true;

            if (spreadDist > 0.4 && indexWristDist > 0.4 && isStationary) {
              openPalmFrames++;
              if (openPalmFrames > 15) {
                if (resetTransformRef.current) resetTransformRef.current();
                openPalmFrames = 0;
              }
            } else {
              openPalmFrames = 0;
            }

            // Pinch-to-scale detection
            if (pinchDist < 0.2) {
              const targetScale = Math.max(0.5, Math.min(2.5, pinchDist * 10));
              scaleRef.current = targetScale;
            }
          }
        } else {
          // Hand left frame - if there was a fast recent flick in history, ensure momentum continues
          if (wristHistoryRef.current.length >= 2) {
            const oldest = wristHistoryRef.current[0];
            const newest = wristHistoryRef.current[wristHistoryRef.current.length - 1];
            const totalDt = Math.max(1, newest.time - oldest.time);
            const totalDx = newest.x - oldest.x;
            const avgVx = totalDx / totalDt;
            if (Math.abs(avgVx) > 0.0007 && Math.abs(totalDx) > 0.03) {
              const angularImpulse = totalDx * 3.5;
              spinVelocityRef.current = Math.max(-0.3, Math.min(0.3, angularImpulse));
            }
          }
          lastWristPos.current = null;
          wristHistoryRef.current = [];
          openPalmFrames = 0;
        }
        
        ctx.restore();
      }
      
      requestAnimationFrame(predictWebcam);
    };

    initMediaPipe();

    // --- CLEANUP ---
    return () => {
      active = false;
      resizeObserver.disconnect();
      cancelAnimationFrame(animationFrameId);
      
      if (mediaStream) {
        mediaStream.getTracks().forEach(track => {
          track.stop();
        });
      }
      if (handLandmarker) {
        handLandmarker.close();
      }
      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, [authToken]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (!file.name.toLowerCase().endsWith('.glb') && !file.name.toLowerCase().endsWith('.gltf')) {
      setModelError("Invalid file type. Please upload a .glb or .gltf file.");
      return;
    }

    try {
      // 1. Save to IndexedDB for device persistence
      await saveCustomModelToIndexedDB(file);
      // 2. Save preference
      await saveActiveModelPreference({ type: 'custom', name: file.name }, authToken);

      const url = URL.createObjectURL(file);
      if (loadModelRef.current) {
        loadModelRef.current(url, file.name, 'custom');
      }
    } catch (err: any) {
      console.error("Custom model upload/save error:", err);
      setModelError(`Failed to save custom model: ${err.message || 'IndexedDB error'}`);
    }
    
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handlePresetLoad = async (presetId: string) => {
    const preset = PRESET_MODELS[presetId];
    if (!preset) return;

    // Save to user profile / localStorage
    await saveActiveModelPreference({ type: 'preset', presetId }, authToken);

    if (loadModelRef.current) {
      loadModelRef.current(preset.url, preset.name, 'preset');
    }
  };

  const handleClearSavedModel = async () => {
    try {
      await clearCustomModelFromIndexedDB();
      await saveActiveModelPreference(null, authToken);
      if (resetToPlaceholderRef.current) {
        resetToPlaceholderRef.current();
      }
    } catch (err) {
      console.warn("Error clearing saved model:", err);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-[#0A0E17]/95 backdrop-blur-xl flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-cyan-500/20 bg-slate-900/50">
        <h2 className="text-cyan-400 font-mono tracking-widest font-semibold flex items-center gap-3">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
          ORION HAND CONTROL OVERRIDE
        </h2>
        <button 
          onClick={onClose}
          className="px-4 py-2 bg-red-500/10 text-red-400 border border-red-500/30 rounded font-mono text-sm hover:bg-red-500/20 flex items-center gap-2 transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
          STOP HAND CONTROL
        </button>
      </div>

      <div className="flex-1 flex overflow-hidden flex-col md:flex-row">
        {/* Control Panel */}
        <div 
          className={`w-full md:w-80 border-b md:border-b-0 md:border-r border-cyan-500/20 bg-slate-950/50 flex flex-col shrink-0 transition-all duration-300 ${
            isMobilePanelMinimized ? 'max-h-[70px] md:max-h-none' : 'max-h-[50vh] md:max-h-none'
          }`}
        >
          <div className="p-4 flex flex-col gap-4 overflow-y-auto h-full w-full">
            <div className="flex items-center justify-between md:hidden shrink-0">
               <span className="text-cyan-500 text-[10px] font-mono font-bold tracking-widest">CONTROLS & CAMERA</span>
               <button 
                 onClick={() => setIsMobilePanelMinimized(!isMobilePanelMinimized)}
                 className="text-cyan-400 px-2 py-1 border border-cyan-500/30 rounded text-[10px] uppercase font-mono hover:bg-cyan-500/10 cursor-pointer"
               >
                 {isMobilePanelMinimized ? 'EXPAND' : 'COLLAPSE'}
               </button>
            </div>
            
            <div className={isMobilePanelMinimized ? 'hidden md:flex flex-col gap-4' : 'flex flex-col gap-4'}>
              {/* Camera Feed */}
              <div className="relative w-full aspect-video rounded-lg overflow-hidden border border-cyan-500/30 bg-black shrink-0">
                <video 
                  ref={videoRef} 
                  autoPlay 
                  playsInline 
                  muted 
                  className="absolute inset-0 w-full h-full object-cover transform -scale-x-100 opacity-30 grayscale"
                />
                <canvas 
                  ref={canvasRef} 
                  className="absolute inset-0 w-full h-full object-cover transform -scale-x-100"
                />
                
                <div className="absolute top-2 right-2 px-2 py-1 bg-black/60 border border-cyan-500/30 rounded text-[9px] text-cyan-400 font-mono uppercase backdrop-blur">
                  {status}
                </div>
              </div>

              {/* Active Model Status Card */}
              <div className="bg-cyan-950/30 border border-cyan-500/20 rounded-lg p-3">
                <div className="flex items-center justify-between mb-1">
                  <div className="text-[10px] text-cyan-500 font-mono tracking-wider">ACTIVE 3D OBJECT</div>
                  {loadedModelType === 'custom' && (
                    <span className="flex items-center gap-1 text-[9px] text-amber-400 font-mono bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20">
                      <HardDrive className="w-2.5 h-2.5" /> Local Device
                    </span>
                  )}
                  {loadedModelType === 'preset' && (
                    <span className="flex items-center gap-1 text-[9px] text-emerald-400 font-mono bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                      <UserCheck className="w-2.5 h-2.5" /> Saved Preset
                    </span>
                  )}
                </div>
                <div className="text-cyan-300 font-mono text-sm truncate font-semibold" title={loadedModelName}>
                  {loadedModelName}
                </div>
                {loadedModelType === 'custom' && (
                  <div className="text-[10px] text-slate-400 font-mono mt-1 leading-tight">
                    Custom upload stored in IndexedDB (remembered on this browser).
                  </div>
                )}
              </div>
              
              {/* Gestures Guide */}
              <div className="text-slate-400 font-mono text-xs leading-relaxed bg-slate-900/50 p-3 rounded-lg border border-slate-800">
                <p className="text-cyan-400 mb-2 font-bold tracking-wider flex items-center gap-2">
                  <Hand className="w-4 h-4" />
                  GESTURE MATRIX
                </p>
                <ul className="list-disc pl-4 space-y-1.5 text-[11px]">
                  <li><strong className="text-slate-200">Continuous Rotation:</strong> Move hand horizontally/vertically.</li>
                  <li><strong className="text-cyan-300">Swipe to Spin (Momentum):</strong> Quick horizontal flick & release to spin with inertia.</li>
                  <li><strong className="text-slate-200">Scale / Zoom:</strong> Pinch thumb & index finger.</li>
                  <li><strong className="text-slate-200">Reset Orientation:</strong> Hold static open palm for ~0.5s.</li>
                </ul>
              </div>

              {/* Model Loading */}
              <div className="space-y-3 pt-2 border-t border-cyan-500/20">
                <div className="flex items-center justify-between">
                  <p className="text-cyan-500 font-mono text-xs tracking-widest font-bold flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" /> 3D ASSET SELECTOR
                  </p>
                  {loadedModelType !== 'default' && (
                    <button
                      onClick={handleClearSavedModel}
                      className="text-[10px] text-slate-400 hover:text-red-400 font-mono flex items-center gap-1 transition-colors cursor-pointer"
                      title="Clear saved model preference and reset to default core"
                    >
                      <Trash2 className="w-3 h-3" /> Clear Saved
                    </button>
                  )}
                </div>
                
                {/* File Upload */}
                <input 
                  type="file" 
                  accept=".glb,.gltf" 
                  className="hidden" 
                  ref={fileInputRef} 
                  onChange={handleFileUpload} 
                />
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full px-4 py-2 bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 rounded font-mono text-xs hover:bg-cyan-500/20 flex items-center justify-center gap-2 transition-colors cursor-pointer"
                >
                  <Upload className="w-4 h-4" />
                  UPLOAD CUSTOM .GLB (LOCAL)
                </button>

                {/* Presets */}
                <div className="grid grid-cols-2 gap-2 mt-2">
                  <button 
                    onClick={() => handlePresetLoad('robot')}
                    className={`px-2 py-2 border rounded font-mono text-[10px] uppercase transition-colors cursor-pointer ${
                      loadedModelName === 'Expressive Robot' 
                        ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300' 
                        : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-cyan-500/50 hover:text-cyan-400'
                    }`}
                  >
                    Robot Model
                  </button>
                  <button 
                    onClick={() => handlePresetLoad('engine')}
                    className={`px-2 py-2 border rounded font-mono text-[10px] uppercase transition-colors cursor-pointer ${
                      loadedModelName === 'Ion Drive Engine' 
                        ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300' 
                        : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-cyan-500/50 hover:text-cyan-400'
                    }`}
                  >
                    Engine Part
                  </button>
                  <button 
                    onClick={() => handlePresetLoad('flamingo')}
                    className={`px-2 py-2 border rounded font-mono text-[10px] uppercase transition-colors cursor-pointer ${
                      loadedModelName === 'Flamingo' 
                        ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300' 
                        : 'bg-slate-800 border-slate-700 text-slate-300 hover:border-cyan-500/50 hover:text-cyan-400'
                    }`}
                  >
                    Flamingo
                  </button>
                  <button 
                    onClick={() => {
                      if (resetTransformRef.current) resetTransformRef.current();
                    }}
                    className="px-2 py-2 bg-slate-800 border border-slate-700 text-slate-300 hover:border-cyan-500/50 hover:text-cyan-400 rounded font-mono text-[10px] uppercase transition-colors flex items-center justify-center gap-1 cursor-pointer"
                  >
                    <RotateCcw className="w-3 h-3" /> RESET POS
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 3D Scene */}
        <div className="flex-1 relative bg-[#05070A] overflow-hidden min-h-[300px]">
          <div ref={threeMountRef} className="absolute inset-0" />
          <div className="absolute inset-0 pointer-events-none shadow-[inset_0_0_100px_rgba(0,0,0,0.8)]" />
          <div className="absolute top-4 left-4 text-cyan-500/30 font-mono text-[10px] uppercase pointer-events-none tracking-widest flex items-center gap-2">
            <span>[3D KINETIC RENDER ENGINE ACTIVE]</span>
            {Math.abs(spinVelocityRef.current) > 0.001 && (
              <span className="text-cyan-400 animate-pulse font-bold">[INERTIA MOMENTUM ACTIVE]</span>
            )}
          </div>
          
          {modelError && (
            <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-red-950/80 border border-red-500/50 p-4 rounded-lg flex items-start gap-3 backdrop-blur max-w-sm">
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="text-red-400 font-mono font-bold text-sm mb-1">RENDER FAILURE</h4>
                <p className="text-red-300/80 font-mono text-xs leading-relaxed">{modelError}</p>
                <button 
                  onClick={() => setModelError(null)}
                  className="mt-3 px-3 py-1 bg-red-500/20 text-red-300 text-xs font-mono rounded hover:bg-red-500/30 transition-colors cursor-pointer"
                >
                  DISMISS
                </button>
              </div>
            </div>
          )}

          <div className="absolute bottom-4 left-4 right-4 flex justify-center pointer-events-none">
            <div className="flex gap-2">
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-500/20"></div>
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-500/50"></div>
              <div className="w-1.5 h-1.5 rounded-full bg-cyan-500/20"></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};


