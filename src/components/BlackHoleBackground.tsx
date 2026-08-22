'use client';

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

const DISK_PARTICLES = 9000;
const STAR_COUNT = 3500;

function createHaloTexture() {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const half = size / 2;
  const grad = ctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0.0, 'rgba(0,0,0,0)');
  grad.addColorStop(0.26, 'rgba(0,0,0,0)');
  grad.addColorStop(0.34, 'rgba(255,190,120,0.95)');
  grad.addColorStop(0.42, 'rgba(255,120,40,0.45)');
  grad.addColorStop(0.58, 'rgba(255,80,30,0.12)');
  grad.addColorStop(0.85, 'rgba(120,40,140,0.03)');
  grad.addColorStop(1.0, 'rgba(0,0,0,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

export default function BlackHoleBackground() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(
      55,
      container.clientWidth / container.clientHeight,
      0.1,
      300,
    );

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);
    // ---------- Starfield ----------
    const starGeo = new THREE.BufferGeometry();
    const starPos = new Float32Array(STAR_COUNT * 3);
    for (let i = 0; i < STAR_COUNT; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(70 + Math.random() * 40);
      starPos[i * 3] = v.x;
      starPos[i * 3 + 1] = v.y;
      starPos[i * 3 + 2] = v.z;
    }
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    const starMat = new THREE.PointsMaterial({
      color: 0xcfe0ff,
      size: 0.32,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
    });
    const stars = new THREE.Points(starGeo, starMat);
    scene.add(stars);

    // ---------- Event horizon (black core) ----------
    const coreGeo = new THREE.SphereGeometry(1, 64, 64);
    const coreMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const core = new THREE.Mesh(coreGeo, coreMat);
    scene.add(core);

    // ---------- Photon ring (fresnel rim, back side) ----------
    const ringMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          vView = -mv.xyz;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: `
        varying vec3 vNormal;
        varying vec3 vView;
        void main() {
          float rim = 1.0 - abs(dot(normalize(vNormal), normalize(vView)));
          float glow = pow(rim, 4.0);
          vec3 hot = vec3(1.0, 0.92, 0.75);
          vec3 mid = vec3(1.0, 0.5, 0.18);
          vec3 color = mix(mid, hot, glow);
          gl_FragColor = vec4(color, glow * 1.8);
        }
      `,
    });
    const ringMesh = new THREE.Mesh(new THREE.SphereGeometry(1.06, 64, 64), ringMat);
    scene.add(ringMesh);

    // ---------- Accretion disk (galactic group, tilted) ----------
    const disk = new THREE.Group();
    disk.rotation.x = 0.45;
    disk.rotation.z = 0.15;
    scene.add(disk);

    const rMin = 1.18;
    const rMax = 4.2;
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(DISK_PARTICLES * 3);
    const colors = new Float32Array(DISK_PARTICLES * 3);

    const angles = new Float32Array(DISK_PARTICLES);
    const radii = new Float32Array(DISK_PARTICLES);
    const yOffsets = new Float32Array(DISK_PARTICLES);
    const speeds = new Float32Array(DISK_PARTICLES);

    const color = new THREE.Color();
    for (let i = 0; i < DISK_PARTICLES; i++) {
      const t = Math.pow(Math.random(), 1.6); // bias inward
      radii[i] = rMin + t * (rMax - rMin);
      angles[i] = Math.random() * Math.PI * 2;
      yOffsets[i] = (Math.random() - 0.5) * 0.06 * (1 + t);
      speeds[i] = 0.35 / (0.4 + radii[i] * radii[i]); // Kepler-ish
      const heat = 1 - t;
      color.setHSL(0.06 + heat * 0.07, 1, 0.30 + heat * 0.35);
      colors[i * 3] = color.r;
      colors[i * 3 + 1] = color.g;
      colors[i * 3 + 2] = color.b;
    }
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const diskMat = new THREE.PointsMaterial({
      size: 0.045,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const diskPoints = new THREE.Points(geo, diskMat);
    disk.add(diskPoints);

    // repulsion state for mouse -> particles (in disk local space)
    const repOffset = new Float32Array(DISK_PARTICLES * 3);
    const repVel = new Float32Array(DISK_PARTICLES * 3);

    // lights for cows (scene had no lights before)
    const ambient = new THREE.AmbientLight(0xffffff, 0.85);
    scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xfff2dd, 1.3);
    dirLight.position.set(4, 6, 3);
    scene.add(dirLight);

    // ---------- Audio - Interstellar-inspired (synthesized, no external assets) ----------
    let audioCtx: AudioContext | null = null;
    let masterGain: GainNode | null = null;
    let bgmGain: GainNode | null = null;
    let sfxGain: GainNode | null = null;
    let convolver: ConvolverNode | null = null;
    let organOscs: OscillatorNode[] = [];
    let organGain: GainNode | null = null;
    let organFilter: BiquadFilterNode | null = null;
    let tickInterval: ReturnType<typeof setInterval> | null = null;
    let chordInterval: ReturnType<typeof setInterval> | null = null;
    let isAudioOn = false;
    let isMuted = false;
    let audioReady = false;
    let audioBtn: HTMLButtonElement | null = null;
    const CHORDS: number[][] = [
      [110, 130.81, 164.81],
      [98, 123.47, 146.83],
      [87.31, 110, 130.81],
      [82.41, 98, 123.47],
    ];
    let chordIdx = 0;
    function createReverb(ctx: AudioContext): ConvolverNode {
      const conv = ctx.createConvolver();
      const len = ctx.sampleRate * 3.2;
      const imp = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) {
        const d = imp.getChannelData(ch);
        for (let i = 0; i < len; i++) {
          const t = i / ctx.sampleRate;
          d[i] = (Math.random() * 2 - 1) * Math.pow(1 - t / 3.2, 2.5) * 0.5;
        }
      }
      conv.buffer = imp;
      return conv;
    }
    function ensureAudio(): boolean {
      if (audioCtx && audioCtx.state !== 'closed') {
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return true;
      }
      try {
        const Ctx = (window as any).AudioContext || (window as any).webkitAudioContext;
        audioCtx = new Ctx();
        masterGain = audioCtx!.createGain();
        masterGain.gain.value = 0.55;
        masterGain.connect(audioCtx!.destination);
        bgmGain = audioCtx!.createGain();
        bgmGain.gain.value = 0;
        sfxGain = audioCtx!.createGain();
        sfxGain.gain.value = 0.85;
        convolver = createReverb(audioCtx!);
        convolver.connect(masterGain);
        bgmGain.connect(convolver);
        const sfxDry = audioCtx!.createGain();
        sfxDry.gain.value = 0.6;
        sfxGain.connect(sfxDry);
        sfxDry.connect(masterGain);
        const sfxWet = audioCtx!.createGain();
        sfxWet.gain.value = 0.35;
        sfxGain.connect(sfxWet);
        sfxWet.connect(convolver);
        return true;
      } catch { return false; }
    }
    function startBGM() {
      if (!audioCtx || !bgmGain || !convolver) return;
      stopBGM();
      organGain = audioCtx!.createGain();
      organGain.gain.value = 0;
      organFilter = audioCtx.createBiquadFilter();
      organFilter.type = 'lowpass';
      organFilter.frequency.value = 1400;
      organFilter.Q.value = 0.7;
      organGain.connect(organFilter);
      organFilter.connect(bgmGain);
      const playChord = (freqs: number[]) => {
        for (const o of organOscs) { try { o.stop(audioCtx!.currentTime + 2.2); } catch {} }
        organOscs = [];
        for (const f of freqs) {
          for (const det of [-0.07, 0.07]) {
            const osc = audioCtx!.createOscillator();
            osc.type = 'sawtooth';
            osc.frequency.value = f * (1 + det * 0.008);
            const g = audioCtx!.createGain();
            g.gain.value = 0.09;
            osc.connect(g);
            g.connect(organGain!);
            osc.start();
            organOscs.push(osc);
          }
          const osc2 = audioCtx!.createOscillator();
          osc2.type = 'triangle';
          osc2.frequency.value = f * 2;
          const g2 = audioCtx!.createGain();
          g2.gain.value = 0.035;
          osc2.connect(g2);
          g2.connect(organGain!);
          osc2.start();
          organOscs.push(osc2);
        }
      };
      playChord(CHORDS[chordIdx]);
      organGain.gain.linearRampToValueAtTime(0.42, audioCtx.currentTime + 2.5);
      bgmGain.gain.linearRampToValueAtTime(0.55, audioCtx.currentTime + 1.2);
      chordInterval = setInterval(() => {
        chordIdx = (chordIdx + 1) % CHORDS.length;
        const next = CHORDS[chordIdx];
        if (organFilter) {
          organFilter.frequency.linearRampToValueAtTime(900, audioCtx!.currentTime + 0.6);
          setTimeout(() => organFilter!.frequency.linearRampToValueAtTime(1400, audioCtx!.currentTime + 1.2), 700);
        }
        playChord(next);
      }, 7000) as unknown as ReturnType<typeof setInterval>;
      const tick = () => playTick();
      tick();
      tickInterval = setInterval(tick, 1523) as unknown as ReturnType<typeof setInterval>;
    }
    function stopBGM() {
      if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
      if (chordInterval) { clearInterval(chordInterval); chordInterval = null; }
      for (const o of organOscs) { try { o.stop(); o.disconnect(); } catch {} }
      organOscs = [];
      if (organGain) { try { organGain.gain.linearRampToValueAtTime(0, audioCtx!.currentTime + 0.8); } catch {} }
    }
    function playTick() {
      if (!audioCtx || !sfxGain || isMuted) return;
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const gain = audioCtx!.createGain();
      const filt = audioCtx.createBiquadFilter();
      filt.type = 'highpass'; filt.frequency.value = 1200;
      osc.type = 'square';
      osc.frequency.value = 1800;
      gain.gain.setValueAtTime(0.5, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
      osc.connect(filt); filt.connect(gain); gain.connect(sfxGain);
      osc.start(t); osc.stop(t + 0.13);
    }
    function playMoo() {
      if (!audioCtx || !sfxGain || isMuted) return;
      const t = audioCtx.currentTime;
      for (const det of [-1, 1]) {
        const osc = audioCtx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(280 + det * 6, t);
        osc.frequency.exponentialRampToValueAtTime(95, t + 0.55);
        const filt = audioCtx.createBiquadFilter();
        filt.type = 'bandpass'; filt.frequency.value = 650; filt.Q.value = 4;
        const g = audioCtx!.createGain();
        g.gain.setValueAtTime(0.45, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
        osc.connect(filt); filt.connect(g); g.connect(sfxGain);
        osc.start(t); osc.stop(t + 0.66);
      }
      const n = audioCtx.createOscillator();
      n.type = 'triangle';
      n.frequency.setValueAtTime(420, t);
      n.frequency.linearRampToValueAtTime(310, t + 0.3);
      const ng = audioCtx!.createGain();
      ng.gain.setValueAtTime(0.18, t);
      ng.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      n.connect(ng); ng.connect(sfxGain);
      n.start(t); n.stop(t + 0.36);
    }
    function playWhoosh() {
      if (!audioCtx || !sfxGain || isMuted) return;
      const t = audioCtx.currentTime;
      const buf = audioCtx!.createBuffer(1, audioCtx!.sampleRate * 0.5, audioCtx!.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 1.8);
      const src = audioCtx!.createBufferSource();
      src.buffer = buf;
      const filt = audioCtx.createBiquadFilter();
      filt.type = 'bandpass'; filt.frequency.setValueAtTime(900, t); filt.frequency.linearRampToValueAtTime(220, t + 0.45);
      filt.Q.value = 1.2;
      const g = audioCtx!.createGain();
      g.gain.setValueAtTime(0.35, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
      src.connect(filt); filt.connect(g); g.connect(sfxGain);
      src.start(t);
    }
    function playSwallow() {
      if (!audioCtx || !sfxGain || isMuted) return;
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(90, t);
      osc.frequency.exponentialRampToValueAtTime(22, t + 1.4);
      const g = audioCtx!.createGain();
      g.gain.setValueAtTime(0.85, t);
      g.gain.linearRampToValueAtTime(0.6, t + 0.25);
      g.gain.exponentialRampToValueAtTime(0.001, t + 1.5);
      const shaper = audioCtx.createWaveShaper();
      shaper.curve = new Float32Array(256).map((_, i) => Math.tanh((i - 128) / 64 * 1.8));
      shaper.oversample = '2x';
      osc.connect(shaper); shaper.connect(g); g.connect(sfxGain);
      if (bgmGain) {
        bgmGain.gain.linearRampToValueAtTime(0.18, t + 0.15);
        bgmGain.gain.linearRampToValueAtTime(0.55, t + 1.6);
      }
      osc.start(t); osc.stop(t + 1.6);
      setTimeout(() => {
        if (!audioCtx || isMuted) return;
        const o2 = audioCtx!.createOscillator();
        o2.type = 'sawtooth';
        o2.frequency.setValueAtTime(180, audioCtx!.currentTime);
        o2.frequency.exponentialRampToValueAtTime(40, audioCtx!.currentTime + 0.9);
        const f2 = audioCtx!.createBiquadFilter(); f2.type = 'lowpass'; f2.frequency.value = 700;
        const g2 = audioCtx!.createGain(); g2.gain.setValueAtTime(0.22, audioCtx!.currentTime); g2.gain.exponentialRampToValueAtTime(0.001, audioCtx!.currentTime + 1.0);
        o2.connect(f2); f2.connect(g2); g2.connect(sfxGain!);
        o2.start(); o2.stop(audioCtx!.currentTime + 1.05);
      }, 120);
    }

    // ---------- Lensed halo (iconic "disk over the top" ring) ----------
    const haloTex = createHaloTexture();
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: haloTex,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    halo.scale.setScalar(3.4);
    scene.add(halo);

    // ---------- Cows that get spaghettified ----------
    type Cow = {
      group: THREE.Group;
      vel: THREE.Vector3;
      age: number;
    };
    const cows: Cow[] = [];
    const cowWhiteMat = new THREE.MeshStandardMaterial({ color: 0xfffff0, roughness: 0.6 });
    const cowBlackMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.7 });
    const cowPinkMat = new THREE.MeshStandardMaterial({ color: 0xff9eb5, roughness: 0.6 });
    const cowHornMat = new THREE.MeshStandardMaterial({ color: 0xe8d8a8, roughness: 0.5 });

    function createCowMesh(): THREE.Group {
      const g = new THREE.Group();
      // body
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.32, 0.72), cowWhiteMat);
      body.position.set(0, 0.28, 0);
      g.add(body);
      // black spots (two patches)
      const spot1 = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.06, 0.3), cowBlackMat);
      spot1.position.set(0.12, 0.45, 0.05);
      g.add(spot1);
      const spot2 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.06, 0.28), cowBlackMat);
      spot2.position.set(-0.12, 0.45, -0.12);
      g.add(spot2);
      // head
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.26, 0.28), cowWhiteMat);
      head.position.set(0, 0.42, 0.52);
      g.add(head);
      // muzzle pink
      const muzzle = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.12, 0.08), cowPinkMat);
      muzzle.position.set(0, 0.36, 0.69);
      g.add(muzzle);
      // nostrils
      const n1 = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.01), cowBlackMat);
      n1.position.set(-0.05, 0.36, 0.735);
      g.add(n1);
      const n2 = n1.clone();
      n2.position.x = 0.05;
      g.add(n2);
      // ears
      const earGeo = new THREE.BoxGeometry(0.1, 0.06, 0.04);
      const earL = new THREE.Mesh(earGeo, cowPinkMat);
      earL.position.set(-0.19, 0.48, 0.5);
      g.add(earL);
      const earR = earL.clone();
      earR.position.x = 0.19;
      g.add(earR);
      // horns
      const hornGeo = new THREE.ConeGeometry(0.04, 0.1, 8);
      const hornL = new THREE.Mesh(hornGeo, cowHornMat);
      hornL.position.set(-0.12, 0.58, 0.48);
      hornL.rotation.z = 0.4;
      g.add(hornL);
      const hornR = hornL.clone();
      hornR.position.x = 0.12;
      hornR.rotation.z = -0.4;
      g.add(hornR);
      // eyes
      const eyeGeo = new THREE.BoxGeometry(0.04, 0.04, 0.02);
      const eyeL = new THREE.Mesh(eyeGeo, cowBlackMat);
      eyeL.position.set(-0.1, 0.46, 0.66);
      g.add(eyeL);
      const eyeR = eyeL.clone();
      eyeR.position.x = 0.1;
      g.add(eyeR);
      // legs
      const legGeo = new THREE.BoxGeometry(0.09, 0.28, 0.09);
      const legMat = cowWhiteMat;
      const positionsLeg: [number, number][] = [
        [-0.16, 0.22],
        [0.16, 0.22],
        [-0.16, -0.22],
        [0.16, -0.22],
      ];
      for (const [x, z] of positionsLeg) {
        const leg = new THREE.Mesh(legGeo, legMat);
        leg.position.set(x, 0.14, z);
        g.add(leg);
        const hoof = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.05, 0.095), cowBlackMat);
        hoof.position.set(x, 0.025, z);
        g.add(hoof);
      }
      // tail
      const tail = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.22), cowWhiteMat);
      tail.position.set(0, 0.32, -0.46);
      g.add(tail);
      const tailTip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), cowBlackMat);
      tailTip.position.set(0, 0.32, -0.58);
      g.add(tailTip);
      g.scale.setScalar(0.85);
      return g;
    }

    function spawnCow(ray: THREE.Ray) {
      const g = createCowMesh();
      // spawn a bit in front of the camera along the click ray, or randomly above if ray is bad
      const spawnDist = 5.2 + Math.random() * 0.8;
      const spawnPos = ray.origin.clone().addScaledVector(ray.direction, spawnDist);
      // if spawn is too close to origin, push outwards
      if (spawnPos.length() < 3.5) {
        spawnPos.normalize().multiplyScalar(5.5);
        spawnPos.y += (Math.random() - 0.5) * 0.8;
      }
      g.position.copy(spawnPos);
      scene.add(g);
      const toCenter = new THREE.Vector3().subVectors(new THREE.Vector3(0, 0, 0), spawnPos).normalize();
      // tangential component for spiral
      const up = new THREE.Vector3(0, 1, 0);
      let tangent = new THREE.Vector3().crossVectors(toCenter, up);
      if (tangent.lengthSq() < 0.01) tangent.set(1, 0, 0);
      tangent.normalize();
      const vel = toCenter.clone().multiplyScalar(1.8 + Math.random() * 1.2);
      vel.addScaledVector(tangent, (Math.random() - 0.5) * 1.8);
      vel.y += (Math.random() - 0.5) * 0.6;
      cows.push({ group: g, vel, age: 0 });
      // brief halo pulse
      halo.scale.setScalar(4.2);
      setTimeout(() => halo.scale.setScalar(3.4), 180);
      // audio: auto-enable BGM on first throw (gesture unlocks AudioContext)
      if (!audioReady) {
        if (ensureAudio()) {
          audioReady = true;
          isAudioOn = true;
          isMuted = false;
          startBGM();
          if (audioBtn) audioBtn.textContent = '\uD83D\uDD0A Interstellar \u2022 ON';
        }
      }
      playMoo();
      playWhoosh();
    }

    // ---------- Post-processing bloom ----------
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(
      new THREE.Vector2(container.clientWidth, container.clientHeight),
      1.15,
      0.75,
      0.1,
    );
    composer.addPass(bloom);
    // -- audio UI --
    audioBtn = document.createElement('button');
    audioBtn.textContent = '\uD83D\uDD07 Enable sound';
    audioBtn.style.cssText = 'position:absolute;top:14px;right:14px;z-index:10;padding:7px 12px;border-radius:999px;border:1px solid rgba(255,255,255,0.18);background:rgba(15,15,20,0.72);backdrop-filter:blur(8px);color:#fff;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;cursor:pointer;';
    container.appendChild(audioBtn);
    const updateBtn = () => {
      if (!audioBtn) return;
      audioBtn.textContent = isAudioOn && !isMuted ? '\uD83D\uDD0A Interstellar \u2022 ON' : isAudioOn && isMuted ? '\uD83D\uDD07 Muted' : '\uD83D\uDD07 Enable sound';
      audioBtn.style.opacity = isAudioOn ? '1' : '0.9';
    };
    audioBtn.addEventListener('click', () => {
      if (!audioReady) {
        if (!ensureAudio()) return;
        audioReady = true;
        isAudioOn = true;
        isMuted = false;
        startBGM();
        updateBtn();
        playWhoosh();
        return;
      }
      if (!isAudioOn) {
        isAudioOn = true; isMuted = false;
        if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
        startBGM();
      } else {
        isMuted = !isMuted;
        if (masterGain) masterGain.gain.linearRampToValueAtTime(isMuted ? 0 : 0.55, audioCtx!.currentTime + 0.25);
        if (isMuted) stopBGM(); else startBGM();
      }
      updateBtn();
    });


    // ---------- Animation ----------
    const clock = new THREE.Clock();
    let time = 0;
    let rafId = 0;

    // Interactive camera state
    let camAngle = 0.4;
    let camElev = 1.6;
    let camDist = 7.4;
    let targetDist = camDist;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let lookX = 0;
    let lookY = 0;
    const mouse = { nx: 0, ny: 0 };

    const raycaster = new THREE.Raycaster();
    const mouseLocalPos = new THREE.Vector3();
    const tmpMat = new THREE.Matrix4();
    const tmpOrigin = new THREE.Vector3();
    const tmpDir = new THREE.Vector3();
    // for hover cursor
    const hoverRaycaster = new THREE.Raycaster();

    const animate = () => {
      const dt = Math.min(clock.getDelta(), 0.05);
      time += dt;

      // --- mouse -> disk local point (for repulsion) ---
      let mouseLocalActive = false;
      // need up-to-date world matrix for disk
      disk.updateMatrixWorld();
      raycaster.setFromCamera(new THREE.Vector2(mouse.nx, mouse.ny), camera);
      tmpMat.copy(disk.matrixWorld).invert();
      tmpOrigin.copy(raycaster.ray.origin).applyMatrix4(tmpMat);
      tmpDir.copy(raycaster.ray.direction).transformDirection(tmpMat);
      if (Math.abs(tmpDir.y) > 0.02) {
        const t = -tmpOrigin.y / tmpDir.y;
        if (t > 0 && t < 80) {
          mouseLocalPos.copy(tmpOrigin).addScaledVector(tmpDir, t);
          // only if within reasonable disk radius
          if (mouseLocalPos.length() < 10) mouseLocalActive = true;
        }
      }

      // hover feedback: raycast core to set cursor
      hoverRaycaster.setFromCamera(new THREE.Vector2(mouse.nx, mouse.ny), camera);
      const hoverHits = hoverRaycaster.intersectObject(core, false);
      if (hoverHits.length > 0) {
        container.style.cursor = 'pointer';
      } else {
        container.style.cursor = dragging ? 'grabbing' : 'grab';
      }

      // Update disk particles + repulsion
      const REPEL_RADIUS = 1.55;
      const REPEL_RADIUS2 = REPEL_RADIUS * REPEL_RADIUS;
      const SPRING_K = 3.0;
      const DAMPING = 5.5;
      for (let i = 0; i < DISK_PARTICLES; i++) {
        const r = radii[i];
        const boost = 1 + (1.2 / Math.max(r, 0.5)) * 0.6;
        angles[i] += speeds[i] * boost * dt * 2.2;
        const spiral = r - dt * 0.08 * boost;
        radii[i] = Math.max(rMin * 0.92, spiral);
        if (radii[i] <= rMin * 0.93) {
          radii[i] = rMax * (0.94 + Math.random() * 0.1);
          // reset repulsion for recycled particle
          repOffset[i * 3] = 0;
          repOffset[i * 3 + 1] = 0;
          repOffset[i * 3 + 2] = 0;
          repVel[i * 3] = 0;
          repVel[i * 3 + 1] = 0;
          repVel[i * 3 + 2] = 0;
        }
        const a = angles[i];
        const baseY = yOffsets[i] + Math.sin(a * 3 + i) * 0.008;
        const baseX = Math.cos(a) * radii[i];
        const baseZ = Math.sin(a) * radii[i];

        // repulsion force from mouseLocalPos
        if (mouseLocalActive) {
          const dx = baseX - mouseLocalPos.x;
          const dz = baseZ - mouseLocalPos.z;
          const dy = baseY - mouseLocalPos.y;
          const d2 = dx * dx + dz * dz + dy * dy * 4;
          if (d2 < REPEL_RADIUS2 && d2 > 0.0002) {
            const d = Math.sqrt(d2);
            const falloff = 1 - d / REPEL_RADIUS;
            const strength = 9.0 * falloff * falloff;
            const invD = 1 / d;
            const fx = dx * invD * strength;
            const fz = dz * invD * strength;
            const fy = dy * invD * strength * 0.5;
            repVel[i * 3] += fx * dt * 14;
            repVel[i * 3 + 1] += fy * dt * 14;
            repVel[i * 3 + 2] += fz * dt * 14;
          }
        }

        // spring + damping integration for offset
        const ox = repOffset[i * 3];
        const oy = repOffset[i * 3 + 1];
        const oz = repOffset[i * 3 + 2];
        const vx = repVel[i * 3];
        const vy = repVel[i * 3 + 1];
        const vz = repVel[i * 3 + 2];
        const ax = -SPRING_K * ox - DAMPING * vx;
        const ay = -SPRING_K * oy - DAMPING * vy;
        const az = -SPRING_K * oz - DAMPING * vz;
        const nvx = vx + ax * dt;
        const nvy = vy + ay * dt;
        const nvz = vz + az * dt;
        repVel[i * 3] = nvx;
        repVel[i * 3 + 1] = nvy;
        repVel[i * 3 + 2] = nvz;
        repOffset[i * 3] = ox + nvx * dt;
        repOffset[i * 3 + 1] = oy + nvy * dt;
        repOffset[i * 3 + 2] = oz + nvz * dt;

        const idx = i * 3;
        positions[idx] = baseX + repOffset[i * 3];
        positions[idx + 1] = baseY + repOffset[i * 3 + 1];
        positions[idx + 2] = baseZ + repOffset[i * 3 + 2];
      }
      geo.attributes.position.needsUpdate = true;

      // Camera: auto-orbit + drag orbit + mouse parallax + wheel zoom
      if (!dragging) camAngle += dt * 0.06;
      camDist += (targetDist - camDist) * Math.min(1, dt * 6);
      lookX += (mouse.nx * 0.5 - lookX) * Math.min(1, dt * 3);
      lookY += (mouse.ny * 0.4 - lookY) * Math.min(1, dt * 3);
      camera.position.set(
        Math.sin(camAngle) * camDist,
        camElev + Math.sin(time * 0.11) * 0.3 + mouse.ny * 0.5,
        Math.cos(camAngle) * camDist,
      );
      camera.lookAt(lookX, lookY, 0);

      stars.rotation.y += dt * 0.004;
      core.rotation.y -= dt * 0.02;

      // --- cows: gravity toward center + spaghettify ---
      const G = 7.5;
      for (let ci = cows.length - 1; ci >= 0; ci--) {
        const cow = cows[ci];
        cow.age += dt;
        const pos = cow.group.position;
        const rLen = pos.length();
        if (rLen > 0.2) {
          const accelMag = G / (rLen * rLen + 0.6);
          const acc = pos.clone().normalize().multiplyScalar(-accelMag);
          cow.vel.addScaledVector(acc, dt);
          // slight orbital damping to spiral in
          cow.vel.multiplyScalar(0.998);
        }
        pos.addScaledVector(cow.vel, dt);
        cow.group.position.copy(pos);

        // orient to face center
        if (rLen > 0.1) {
          const target = new THREE.Vector3(0, 0, 0);
          // lookAt makes +Z toward target; cow front is +Z so good
          cow.group.lookAt(target);
          // keep belly down a bit
          cow.group.rotateX(Math.PI);
        }
        // tumbling
        cow.group.rotateZ(dt * 1.2);
        cow.group.rotateX(dt * 0.6);

        const dist = pos.length();
        if (dist < 1.7) {
          const stretch = 1 + (1.7 - dist) * 3.0;
          const lateral = 1 / Math.pow(stretch, 0.45);
          cow.group.scale.set(lateral, lateral, Math.min(stretch, 4.5));
        } else {
          cow.group.scale.setScalar(0.85);
        }

        if (dist < 0.88) {
          // swallowed
          playSwallow();
          halo.scale.setScalar(4.8);
          setTimeout(() => halo.scale.setScalar(3.4), 220);
          scene.remove(cow.group);
          cows.splice(ci, 1);
          // dispose geometries are shared? each cow cloned geos but shared mats – just remove group
          // traverse dispose for unique geos
          cow.group.traverse((obj) => {
            if ((obj as THREE.Mesh).isMesh) {
              const m = obj as THREE.Mesh;
              // geometries are cloned per mesh but we share mat, so dispose geo
              m.geometry.dispose();
            }
          });
        }
      }

      composer.render();
      rafId = requestAnimationFrame(animate);
    };

rafId = requestAnimationFrame(animate);

    const clampCam = () => {
      camElev = Math.max(0.3, Math.min(6, camElev));
      camDist = Math.max(3.5, Math.min(14, camDist));
    };

    let downX = 0;
    let downY = 0;

    const onMouseMove = (e: MouseEvent) => {
      mouse.nx = (e.clientX / window.innerWidth) * 2 - 1;
      mouse.ny = -((e.clientY / window.innerHeight) * 2 - 1);
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      camAngle -= dx * 0.005;
      camElev += dy * 0.02;
      clampCam();
    };

    const onMouseDown = (e: MouseEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      downX = e.clientX;
      downY = e.clientY;
    };
    const onMouseUp = (e: MouseEvent) => {
      const wasDragging = dragging;
      dragging = false;
      const moved = Math.hypot(e.clientX - downX, e.clientY - downY);
      if (moved > 8) return;
      // ignore clicks on UI (inputs/buttons/todo cards)
      const target = e.target as HTMLElement | null;
      if (target && target.closest('input, button, a, ul, li, [data-ui]')) return;
      // also if the todo card container was hit - check element at point
      const elAt = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      if (elAt && elAt.closest('input, button, a, ul, li')) return;
      // raycast to black hole core
      const ndc = new THREE.Vector2((e.clientX / window.innerWidth) * 2 - 1, -((e.clientY / window.innerHeight) * 2 - 1));
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObject(core, false);
      // also accept ring/halo proximity: if ray passes within 1.35 of center, treat as hit in center
      let isCenter = hits.length > 0;
      if (!isCenter) {
        // distance from ray to origin
        const ro = raycaster.ray.origin;
        const rd = raycaster.ray.direction;
        const toCenter = new THREE.Vector3().subVectors(new THREE.Vector3(0, 0, 0), ro);
        const t = toCenter.dot(rd);
        const closest = ro.clone().addScaledVector(rd, Math.max(0, t));
        if (closest.length() < 1.35) isCenter = true;
      }
      if (isCenter) {
        spawnCow(raycaster.ray.clone());
      }
    };
    const onWheel = (e: WheelEvent) => {
      targetDist += e.deltaY * 0.006;
      targetDist = Math.max(3.5, Math.min(14, targetDist));
      clampCam();
    };

    // Touch support
    let touchDownX = 0;
    let touchDownY = 0;
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      mouse.nx = (t.clientX / window.innerWidth) * 2 - 1;
      mouse.ny = -((t.clientY / window.innerHeight) * 2 - 1);
      if (!dragging) {
        lastX = t.clientX;
        lastY = t.clientY;
      } else {
        const dx = t.clientX - lastX;
        const dy = t.clientY - lastY;
        lastX = t.clientX;
        lastY = t.clientY;
        camAngle -= dx * 0.005;
        camElev += dy * 0.02;
        clampCam();
      }
    };
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      dragging = true;
      const t = e.touches[0];
      lastX = t.clientX;
      lastY = t.clientY;
      touchDownX = t.clientX;
      touchDownY = t.clientY;
      mouse.nx = (t.clientX / window.innerWidth) * 2 - 1;
      mouse.ny = -((t.clientY / window.innerHeight) * 2 - 1);
    };
    const onTouchEnd = (e: TouchEvent) => {
      dragging = false;
      const t = e.changedTouches[0];
      if (!t) return;
      const moved = Math.hypot(t.clientX - touchDownX, t.clientY - touchDownY);
      if (moved > 12) return;
      const target = e.target as HTMLElement | null;
      if (target && target.closest('input, button, a, ul, li')) return;
      const ndc = new THREE.Vector2((t.clientX / window.innerWidth) * 2 - 1, -((t.clientY / window.innerHeight) * 2 - 1));
      raycaster.setFromCamera(ndc, camera);
      const hits = raycaster.intersectObject(core, false);
      let isCenter = hits.length > 0;
      if (!isCenter) {
        const ro = raycaster.ray.origin;
        const rd = raycaster.ray.direction;
        const toCenter = new THREE.Vector3().subVectors(new THREE.Vector3(0, 0, 0), ro);
        const tt = toCenter.dot(rd);
        const closest = ro.clone().addScaledVector(rd, Math.max(0, tt));
        if (closest.length() < 1.35) isCenter = true;
      }
      if (isCenter) spawnCow(raycaster.ray.clone());
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('wheel', onWheel, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd);
    const onResize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
      stopBGM();
      if (audioCtx) { try { audioCtx.close(); } catch {} audioCtx = null; }
      if (audioBtn && audioBtn.parentElement === container) container.removeChild(audioBtn);
      // remove cows
      for (const cow of cows) {
        scene.remove(cow.group);
        cow.group.traverse((obj) => {
          if ((obj as THREE.Mesh).isMesh) (obj as THREE.Mesh).geometry.dispose();
        });
      }
      cows.length = 0;
      composer.dispose();
      starGeo.dispose();
      starMat.dispose();
      coreGeo.dispose();
      coreMat.dispose();
      ringMat.dispose();
      geo.dispose();
      diskMat.dispose();
      haloTex.dispose();
      (halo.material as THREE.SpriteMaterial).dispose();
      cowWhiteMat.dispose();
      cowBlackMat.dispose();
      cowPinkMat.dispose();
      cowHornMat.dispose();
      renderer.dispose();
      container.style.cursor = '';
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div ref={containerRef} className="fixed inset-0 z-0 overflow-hidden bg-black">
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-white/45 text-[11px] tracking-[0.18em] uppercase pointer-events-none select-none whitespace-nowrap">
        click the void — throw in a cow 🐄
      </div>
    </div>
  );
}
