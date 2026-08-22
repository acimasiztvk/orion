import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrionState } from '../types';

interface OrionGlobeProps {
  state: OrionState;
  analyser?: AnalyserNode | null;
  className?: string;
  onClick?: () => void;
  isTaskPulse?: boolean;
  isVoiceEnabled?: boolean;
  isLiveConnected?: boolean;
}

export const OrionGlobe: React.FC<OrionGlobeProps> = ({
  state,
  analyser,
  className = '',
  onClick,
  isTaskPulse = false,
  isVoiceEnabled = false,
  isLiveConnected = false
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<OrionState>(state);
  stateRef.current = state;

  const pulseRef = useRef<boolean>(isTaskPulse);
  pulseRef.current = isTaskPulse;

  const analyserRef = useRef<AnalyserNode | null>(analyser || null);
  analyserRef.current = analyser || null;

  // Auto-fade timer state for status badge
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [isHovered, setIsHovered] = useState<boolean>(false);
  const lastStateKeyRef = useRef<string>('');

  const currentStateKey = `${state}_${isVoiceEnabled}_${isLiveConnected}`;

  useEffect(() => {
    if (lastStateKeyRef.current !== currentStateKey) {
      lastStateKeyRef.current = currentStateKey;
      setIsExpanded(true);
      const timer = setTimeout(() => {
        setIsExpanded(false);
      }, 2500);
      return () => clearTimeout(timer);
    }
  }, [currentStateKey]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // Scene, Camera, Renderer
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
      45,
      container.clientWidth / container.clientHeight,
      0.1,
      1000
    );
    camera.position.z = 7.5;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    // Master Globe Group
    const masterGroup = new THREE.Group();
    scene.add(masterGroup);

    // 1. Holographic Wireframe Outer Sphere
    const sphereRadius = 2.2;
    const wireframeGeo = new THREE.IcosahedronGeometry(sphereRadius, 5);
    const wireframeMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      wireframe: true,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending
    });
    const wireframeSphere = new THREE.Mesh(wireframeGeo, wireframeMat);
    masterGroup.add(wireframeSphere);

    // 2. Latitude / Longitude Holographic Ring Grid
    const latLonGroup = new THREE.Group();
    const ringMat = new THREE.LineBasicMaterial({
      color: 0x00d2ff,
      transparent: true,
      opacity: 0.45,
      blending: THREE.AdditiveBlending
    });

    // Generate latitude rings
    for (let i = -4; i <= 4; i++) {
      if (i === 0) continue;
      const angle = (i * Math.PI) / 10;
      const r = sphereRadius * Math.cos(angle);
      const y = sphereRadius * Math.sin(angle);
      const ringGeo = new THREE.BufferGeometry();
      const points: THREE.Vector3[] = [];
      const segments = 64;
      for (let j = 0; j <= segments; j++) {
        const theta = (j / segments) * Math.PI * 2;
        points.push(new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r));
      }
      ringGeo.setFromPoints(points);
      const ring = new THREE.Line(ringGeo, ringMat);
      latLonGroup.add(ring);
    }

    // Generate longitude meridian circles
    for (let i = 0; i < 6; i++) {
      const ringGeo = new THREE.BufferGeometry();
      const points: THREE.Vector3[] = [];
      const segments = 64;
      for (let j = 0; j <= segments; j++) {
        const theta = (j / segments) * Math.PI * 2;
        points.push(new THREE.Vector3(Math.cos(theta) * sphereRadius, Math.sin(theta) * sphereRadius, 0));
      }
      ringGeo.setFromPoints(points);
      const ring = new THREE.Line(ringGeo, ringMat);
      ring.rotation.y = (i * Math.PI) / 6;
      latLonGroup.add(ring);
    }
    masterGroup.add(latLonGroup);

    // 3. Inner Glowing Energy Core
    const coreGeo = new THREE.SphereGeometry(sphereRadius * 0.72, 32, 32);
    const coreMat = new THREE.MeshBasicMaterial({
      color: 0x0055ff,
      transparent: true,
      opacity: 0.28,
      blending: THREE.AdditiveBlending
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    masterGroup.add(coreMesh);

    // 4. Center Dense Quantum Orb
    const centerOrbGeo = new THREE.SphereGeometry(sphereRadius * 0.35, 24, 24);
    const centerOrbMat = new THREE.MeshBasicMaterial({
      color: 0x00f0ff,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending
    });
    const centerOrb = new THREE.Mesh(centerOrbGeo, centerOrbMat);
    masterGroup.add(centerOrb);

    // 5. JARVIS Concentric Orbital HUD Rings
    const createHudRing = (radius: number, color: number, tiltX: number, tiltZ: number) => {
      const ringGeo = new THREE.BufferGeometry();
      const points: THREE.Vector3[] = [];
      const segments = 90;
      for (let j = 0; j <= segments; j++) {
        const theta = (j / segments) * Math.PI * 2;
        points.push(new THREE.Vector3(Math.cos(theta) * radius, 0, Math.sin(theta) * radius));
      }
      ringGeo.setFromPoints(points);
      const ring = new THREE.Line(
        ringGeo,
        new THREE.LineBasicMaterial({
          color,
          transparent: true,
          opacity: 0.5,
          blending: THREE.AdditiveBlending
        })
      );
      ring.rotation.x = tiltX;
      ring.rotation.z = tiltZ;
      return ring;
    };

    const hudRing1 = createHudRing(sphereRadius * 1.35, 0x00f0ff, Math.PI / 6, Math.PI / 8);
    const hudRing2 = createHudRing(sphereRadius * 1.55, 0x0088ff, -Math.PI / 4, -Math.PI / 6);
    const hudRing3 = createHudRing(sphereRadius * 1.75, 0x00ffcc, Math.PI / 3, -Math.PI / 4);
    scene.add(hudRing1);
    scene.add(hudRing2);
    scene.add(hudRing3);

    // 6. Floating Holographic Particle Cloud
    const particleCount = 450;
    const particleGeo = new THREE.BufferGeometry();
    const particlePositions = new Float32Array(particleCount * 3);
    const particleColors = new Float32Array(particleCount * 3);

    for (let i = 0; i < particleCount; i++) {
      const u = Math.random();
      const v = Math.random();
      const theta = u * 2.0 * Math.PI;
      const phi = Math.acos(2.0 * v - 1.0);
      const r = sphereRadius * (0.85 + Math.random() * 0.9);

      const sinPhi = Math.sin(phi);
      particlePositions[i * 3] = r * sinPhi * Math.cos(theta);
      particlePositions[i * 3 + 1] = r * sinPhi * Math.sin(theta);
      particlePositions[i * 3 + 2] = r * Math.cos(phi);

      // Cyan to Electric Blue gradient
      particleColors[i * 3] = 0.0;
      particleColors[i * 3 + 1] = 0.8 + Math.random() * 0.2;
      particleColors[i * 3 + 2] = 1.0;
    }

    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePositions, 3));
    particleGeo.setAttribute('color', new THREE.BufferAttribute(particleColors, 3));

    const particleMat = new THREE.PointsMaterial({
      size: 0.045,
      vertexColors: true,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending
    });
    const particles = new THREE.Points(particleGeo, particleMat);
    masterGroup.add(particles);

    // 7. Ambient Hologram Lighting
    const ambientLight = new THREE.AmbientLight(0x002244, 1.5);
    scene.add(ambientLight);

    const pointLight = new THREE.PointLight(0x00f0ff, 3, 20);
    pointLight.position.set(0, 0, 0);
    scene.add(pointLight);

    // Resize Observer
    const handleResize = () => {
      if (!container) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width === 0 || height === 0) return;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    // Animation Variables
    let animationFrameId: number;
    let clock = new THREE.Clock();
    const audioDataArray = new Uint8Array(128);

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const elapsed = clock.getElapsedTime();
      const currentState = stateRef.current;

      // Calculate audio amplitude if available
      let audioAmp = 0;
      if (analyserRef.current) {
        try {
          analyserRef.current.getByteFrequencyData(audioDataArray);
          let sum = 0;
          for (let i = 0; i < 32; i++) {
            sum += audioDataArray[i];
          }
          audioAmp = (sum / 32) / 255; // 0 to 1
        } catch (e) {}
      }

      // State-specific behavior parameters
      let baseSpeed = 0.35;
      let coreScale = 1.0;
      let targetOpacity = 0.35;
      let targetColor = 0x00f0ff;
      let ringSpeedMultiplier = 1.0;
      let particleSpeedMultiplier = 1.0;

      switch (currentState) {
        case 'listening': {
          baseSpeed = 0.55;
          targetColor = 0x00ffcc;
          // React to microphone audio amplitude
          const micPulse = audioAmp * 0.5;
          coreScale = 1.05 + Math.sin(elapsed * 6) * 0.04 + micPulse;
          targetOpacity = 0.55 + micPulse * 0.3;
          ringSpeedMultiplier = 1.6;
          particleSpeedMultiplier = 1.8;
          break;
        }
        case 'thinking': {
          baseSpeed = 1.4;
          targetColor = 0x00e5ff;
          // Flicker / neural shimmer
          const shimmer = (Math.sin(elapsed * 18) + Math.cos(elapsed * 25)) * 0.05;
          coreScale = 1.0 + shimmer;
          targetOpacity = 0.5 + Math.sin(elapsed * 12) * 0.15;
          ringSpeedMultiplier = 2.8;
          particleSpeedMultiplier = 2.5;
          break;
        }
        case 'speaking': {
          baseSpeed = 0.75;
          targetColor = 0x00d2ff;
          // Rhythmic amplitude pulsing synced to output audio
          const speakPulse = audioAmp > 0.05 ? audioAmp * 0.6 : (Math.sin(elapsed * 9) * 0.12 + 0.12);
          coreScale = 1.0 + speakPulse;
          targetOpacity = 0.45 + speakPulse * 0.4;
          ringSpeedMultiplier = 1.9 + speakPulse * 1.5;
          particleSpeedMultiplier = 2.0;
          break;
        }
        case 'idle':
        default: {
          baseSpeed = 0.35;
          targetColor = 0x00f0ff;
          // Gentle breathing ambient pulse
          const breath = Math.sin(elapsed * 1.5) * 0.03;
          coreScale = 1.0 + breath;
          targetOpacity = 0.35 + Math.sin(elapsed * 1.5) * 0.06;
          ringSpeedMultiplier = 0.8;
          particleSpeedMultiplier = 1.0;
          break;
        }
      }

      // Task Completion Bright Pulse Boost (~1 second burst)
      if (pulseRef.current) {
        coreScale += 0.22;
        targetOpacity = 0.85;
        ringSpeedMultiplier *= 2.8;
        particleSpeedMultiplier *= 2.5;
        targetColor = 0x00ffaa;
      }

      // 1. Rotate Master Globe
      masterGroup.rotation.y += baseSpeed * delta;
      masterGroup.rotation.x = Math.sin(elapsed * 0.4) * 0.08;

      // 2. Rotate HUD Rings
      hudRing1.rotation.y += 0.4 * ringSpeedMultiplier * delta;
      hudRing2.rotation.y -= 0.6 * ringSpeedMultiplier * delta;
      hudRing3.rotation.z += 0.3 * ringSpeedMultiplier * delta;

      // 3. Dynamic Scale Pulsing
      wireframeSphere.scale.set(coreScale, coreScale, coreScale);
      latLonGroup.scale.set(coreScale, coreScale, coreScale);
      coreMesh.scale.set(coreScale * 0.95, coreScale * 0.95, coreScale * 0.95);
      centerOrb.scale.set(
        1.0 + Math.sin(elapsed * 4) * 0.1,
        1.0 + Math.sin(elapsed * 4) * 0.1,
        1.0 + Math.sin(elapsed * 4) * 0.1
      );

      // 4. Update Opacities & Colors
      wireframeMat.opacity = THREE.MathUtils.lerp(wireframeMat.opacity, targetOpacity, 0.1);
      ringMat.opacity = THREE.MathUtils.lerp(ringMat.opacity, targetOpacity * 1.2, 0.1);
      centerOrbMat.opacity = THREE.MathUtils.lerp(centerOrbMat.opacity, targetOpacity * 1.6, 0.1);

      // 5. Orbit Particles
      particles.rotation.y -= 0.15 * particleSpeedMultiplier * delta;
      particles.rotation.x += 0.05 * particleSpeedMultiplier * delta;

      // Point Light intensity
      pointLight.intensity = 2.5 * coreScale;

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();
      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
      wireframeGeo.dispose();
      wireframeMat.dispose();
      coreGeo.dispose();
      coreMat.dispose();
      centerOrbGeo.dispose();
      centerOrbMat.dispose();
      particleGeo.dispose();
      particleMat.dispose();
    };
  }, []);

  return (
    <div
      id="orion-globe-container"
      ref={mountRef}
      onClick={onClick}
      className={`relative cursor-pointer select-none group transition-transform duration-300 hover:scale-105 ${className}`}
      title="ORION Neural Core — Click to speak"
    >
      {/* Interactive Hover Glow Ring */}
      <div className="absolute inset-0 rounded-full border border-transparent group-hover:border-cyan-400/50 shadow-[0_0_0_rgba(34,211,238,0)] group-hover:shadow-[0_0_50px_rgba(34,211,238,0.25)] transition-all duration-300 pointer-events-none z-10" />

      {/* Floating Center Click Cue on Hover */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
        <span className="px-3 py-1.5 rounded-lg bg-slate-950/85 border border-cyan-400/70 text-cyan-300 text-xs font-mono font-bold tracking-wider uppercase shadow-xl backdrop-blur-md">
          {state === 'listening' ? '⏹ STOP LISTENING' : '🎙 CLICK TO SPEAK'}
        </span>
      </div>
      {/* Consolidated Minimal Cyberpunk Status Badge with Auto-Fade */}
      <div
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className="absolute top-2 left-1/2 -translate-x-1/2 z-30 pointer-events-auto transition-all duration-500 ease-out"
      >
        <div
          className={`flex items-center gap-2 rounded-full transition-all duration-500 border backdrop-blur-md cursor-pointer ${
            isExpanded || isHovered
              ? 'px-3 py-1 bg-slate-950/90 border-cyan-500/40 shadow-[0_0_15px_rgba(0,240,255,0.15)] text-xs opacity-100 scale-100'
              : 'px-2.5 py-0.5 bg-slate-950/40 border-slate-800/50 hover:border-cyan-500/30 text-[10px] opacity-60 hover:opacity-100 scale-95'
          }`}
        >
          {/* Animated Status Dot */}
          <span className="relative flex h-2 w-2 items-center justify-center">
            <span
              className={`absolute inline-flex h-full w-full rounded-full opacity-75 ${
                state === 'listening' || isLiveConnected
                  ? 'animate-ping bg-cyan-400'
                  : isVoiceEnabled
                  ? 'animate-pulse bg-emerald-400'
                  : state === 'thinking'
                  ? 'animate-ping bg-amber-400'
                  : state === 'speaking'
                  ? 'animate-pulse bg-cyan-400'
                  : 'bg-slate-500'
              }`}
            />
            <span
              className={`relative inline-flex rounded-full h-1.5 w-1.5 ${
                state === 'listening' || isLiveConnected
                  ? 'bg-cyan-400'
                  : isVoiceEnabled
                  ? 'bg-emerald-400'
                  : state === 'thinking'
                  ? 'bg-amber-400'
                  : state === 'speaking'
                  ? 'bg-cyan-300'
                  : 'bg-slate-500'
              }`}
            />
          </span>

          {/* Text Label: Compact when faded, Full when expanded or hovered */}
          <span className="mono font-semibold uppercase tracking-wider text-slate-300 whitespace-nowrap">
            {isExpanded || isHovered ? (
              state === 'listening' || isLiveConnected
                ? 'LIVE NEURAL STREAM ACTIVE'
                : state === 'thinking'
                ? 'NEURAL SYNAPSE COMPUTING'
                : state === 'speaking'
                ? 'ORION TRANSMITTING SPEECH'
                : isVoiceEnabled
                ? 'LOCAL STANDBY ACTIVE ("ORION")'
                : 'ORION STANDBY MODE'
            ) : (
              state === 'listening' || isLiveConnected
                ? 'LIVE STREAM'
                : state === 'thinking'
                ? 'THINKING'
                : state === 'speaking'
                ? 'SPEAKING'
                : isVoiceEnabled
                ? 'STANDBY'
                : 'ONLINE'
            )}
          </span>
        </div>
      </div>

      {/* Holographic Radar Concentric Circles in Background */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center -z-10">
        <div
          className={`w-[440px] h-[440px] rounded-full border border-cyan-400/10 orb-glow transition-all duration-700 ${
            state === 'listening'
              ? 'scale-110 border-cyan-400/30 animate-pulse'
              : state === 'thinking'
              ? 'scale-105 border-amber-400/20'
              : state === 'speaking'
              ? 'scale-110 border-cyan-400/30 animate-pulse'
              : 'scale-100'
          }`}
        />
        <div
          className="absolute w-[90%] h-[90%] max-w-[400px] max-h-[400px] rounded-full border border-cyan-400/5"
        />

        {/* Artistic Flair SVG HUD reticle rings */}
        <svg className="absolute w-[440px] h-[440px] transform -rotate-12 opacity-50" viewBox="0 0 200 200">
          <defs>
            <radialGradient id="orbGrad" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.12" />
              <stop offset="70%" stopColor="#22d3ee" stopOpacity="0.02" />
              <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
            </radialGradient>
          </defs>
          <circle cx="100" cy="100" r="80" fill="url(#orbGrad)" />
          <path d="M20,100 Q100,20 180,100 Q100,180 20,100" fill="none" stroke="#22d3ee" strokeWidth="0.5" strokeDasharray="2,2" opacity="0.3" />
          <path d="M100,20 Q180,100 100,180 Q20,100 100,20" fill="none" stroke="#22d3ee" strokeWidth="0.5" strokeDasharray="2,2" opacity="0.3" />
          <circle cx="100" cy="100" r="75" fill="none" stroke="#22d3ee" strokeWidth="0.2" opacity="0.5" />
          <g opacity="0.6">
            <circle cx="100" cy="100" r="30" fill="none" stroke="#22d3ee" strokeWidth="1.5" strokeDasharray="10,5" />
            <circle cx="100" cy="100" r="45" fill="none" stroke="#22d3ee" strokeWidth="0.5" />
          </g>
          <g>
            <circle cx="100" cy="100" r="10" fill="#22d3ee" opacity="0.4" />
            <circle cx="100" cy="100" r="15" fill="none" stroke="#22d3ee" strokeWidth="1.5" />
          </g>
        </svg>

        <div className="absolute w-[600px] h-[600px] rounded-full radial-gradient bg-cyan-400/[0.04] blur-3xl pointer-events-none" />
      </div>

      {/* Subtle Audio Frequency Indicator Bars */}
      <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1 h-3.5 pointer-events-none opacity-50">
        <div className={`w-1 bg-cyan-400 rounded-full transition-all duration-150 ${state === 'listening' || state === 'speaking' ? 'h-3 animate-pulse' : 'h-1.5 opacity-40'}`} />
        <div className={`w-1 bg-cyan-400 rounded-full transition-all duration-150 ${state === 'listening' || state === 'speaking' ? 'h-4 animate-bounce' : 'h-2.5 opacity-40'}`} />
        <div className={`w-1 bg-cyan-400 rounded-full transition-all duration-150 ${state === 'listening' || state === 'speaking' ? 'h-2.5 animate-pulse' : 'h-1 opacity-40'}`} />
        <div className={`w-1 bg-cyan-400 rounded-full transition-all duration-150 ${state === 'listening' || state === 'speaking' ? 'h-3.5 animate-bounce' : 'h-2 opacity-40'}`} />
        <div className={`w-1 bg-cyan-400 rounded-full transition-all duration-150 ${state === 'listening' || state === 'speaking' ? 'h-4 animate-pulse' : 'h-1 opacity-40'}`} />
      </div>
    </div>
  );
};
