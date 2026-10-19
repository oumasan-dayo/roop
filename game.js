/**
 * 『同じ廊下』第1段階 3D基礎プロトタイプ
 * Three.js first-person corridor for iPhone Safari
 * Clean modular structure for future expansion
 */

(function () {
  'use strict';

  // ============================================================
  // CONFIG – easy to tune later
  // ============================================================
  const CONFIG = {
    // Player
    eyeHeight: 1.62,
    moveSpeed: 2.4,          // m/s
    playerRadius: 0.28,      // collision radius
    playerHeight: 1.7,

    // Camera
    fov: 68,
    near: 0.08,
    far: 80,
    lookSensitivity: 0.0032, // touch
    mouseSensitivity: 0.0022,
    pitchLimit: Math.PI / 2.3, // ~78 deg

    // Corridor
    corridorLength: 42,      // ~17s walk at 2.4 m/s
    corridorWidth: 3.4,
    corridorHeight: 2.85,

    // Flashlight
    flashlightIntensity: 1.35,
    flashlightDistance: 18,
    flashlightAngle: Math.PI / 5.5,
    flashlightPenumbra: 0.45,
    ambientIntensity: 0.07,
    hemiIntensity: 0.11,

    // Collision padding
    wallPadding: 0.05
  };

  // ============================================================
  // STATE
  // ============================================================
  let renderer, scene, camera, clock;
  let player = {
    position: new THREE.Vector3(0, CONFIG.eyeHeight, 3.5),
    yaw: 0,
    pitch: 0,
    velocity: new THREE.Vector3()
  };

  // Input
  const keys = { forward: false, back: false, left: false, right: false };
  let joystick = { active: false, dx: 0, dy: 0, id: null };
  let lookTouch = { active: false, id: null, lastX: 0, lastY: 0 };
  let mouseLook = { active: false, lastX: 0, lastY: 0 };

  // Colliders (simple AABB boxes)
  const colliders = [];

  // Flashlight
  let flashlight;

  // DOM
  const canvas = document.getElementById('game-canvas');
  const joystickBase = document.getElementById('joystick-base');
  const joystickStick = document.getElementById('joystick-stick');
  const loadingOverlay = document.getElementById('loading-overlay');
  const errorOverlay = document.getElementById('error-overlay');
  const errorMessage = document.getElementById('error-message');

  // ============================================================
  // INIT
  // ============================================================
  function init() {
    try {
      if (!window.THREE) {
        throw new Error('Three.js の読み込みに失敗しました。ネットワーク接続を確認してください。');
      }

      clock = new THREE.Clock();

      // Renderer
      renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: false,          // lower load on mobile
        powerPreference: 'high-performance',
        alpha: false
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.shadowMap.enabled = false; // save performance

      // Scene
      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x0c0b0a);
      scene.fog = new THREE.FogExp2(0x0c0b0a, 0.038);

      // Camera
      camera = new THREE.PerspectiveCamera(
        CONFIG.fov,
        window.innerWidth / window.innerHeight,
        CONFIG.near,
        CONFIG.far
      );
      camera.position.copy(player.position);

      // Lighting
      setupLighting();

      // World
      buildCorridor();
      buildFurniture();
      buildDoor();

      // Input
      setupInput();

      // Resize / visibility
      window.addEventListener('resize', onResize);
      window.addEventListener('orientationchange', () => setTimeout(onResize, 150));
      document.addEventListener('visibilitychange', onVisibilityChange);

      // Start
      loadingOverlay.classList.add('hidden');
      animate();

      console.log('[同じ廊下] 第1段階プロトタイプ起動完了');
    } catch (err) {
      showError(err.message || String(err));
      console.error(err);
    }
  }

  function showError(msg) {
    loadingOverlay.classList.add('hidden');
    errorOverlay.classList.remove('hidden');
    errorMessage.textContent = 'エラーが発生しました\n\n' + msg;
  }

  // ============================================================
  // LIGHTING
  // ============================================================
  function setupLighting() {
    // Very dim ambient – still allows outline recognition
    const ambient = new THREE.AmbientLight(0xb8b0a0, CONFIG.ambientIntensity);
    scene.add(ambient);

    // Soft hemisphere for subtle fill
    const hemi = new THREE.HemisphereLight(0x8a8578, 0x2a2520, CONFIG.hemiIntensity);
    scene.add(hemi);

    // Flashlight (SpotLight attached to camera)
    flashlight = new THREE.SpotLight(
      0xfff0d8,
      CONFIG.flashlightIntensity,
      CONFIG.flashlightDistance,
      CONFIG.flashlightAngle,
      CONFIG.flashlightPenumbra,
      1.2
    );
    flashlight.position.set(0.15, -0.12, 0.05); // slight offset like held light
    flashlight.target.position.set(0, 0, -1);
    camera.add(flashlight);
    camera.add(flashlight.target);
    scene.add(camera); // camera must be in scene for light to work

    // Tiny point light near player for very close surfaces
    const fill = new THREE.PointLight(0xffeedd, 0.18, 3.5, 2);
    fill.position.set(0, -0.2, 0.3);
    camera.add(fill);
  }

  // ============================================================
  // MATERIALS (procedural, muted palette)
  // ============================================================
  function makeMat(color, roughness = 0.92, metalness = 0.02) {
    return new THREE.MeshStandardMaterial({
      color: color,
      roughness: roughness,
      metalness: metalness,
      flatShading: false
    });
  }

  // Simple canvas noise texture for subtle variation
  function createNoiseTexture(size, baseR, baseG, baseB, variance) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * variance;
      img.data[i]     = Math.max(0, Math.min(255, baseR + n));
      img.data[i + 1] = Math.max(0, Math.min(255, baseG + n));
      img.data[i + 2] = Math.max(0, Math.min(255, baseB + n));
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  // ============================================================
  // CORRIDOR GEOMETRY
  // ============================================================
  function buildCorridor() {
    const L = CONFIG.corridorLength;
    const W = CONFIG.corridorWidth;
    const H = CONFIG.corridorHeight;
    const halfW = W / 2;

    // Floor
    const floorTex = createNoiseTexture(128, 78, 70, 58, 18);
    floorTex.repeat.set(L / 2.5, W / 2.5);
    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTex,
      roughness: 0.88,
      metalness: 0.04,
      color: 0x8a7e6a
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, L), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, L / 2);
    scene.add(floor);

    // Ceiling
    const ceilTex = createNoiseTexture(64, 55, 52, 48, 12);
    ceilTex.repeat.set(L / 3, W / 3);
    const ceilMat = new THREE.MeshStandardMaterial({
      map: ceilTex,
      roughness: 0.95,
      metalness: 0.0,
      color: 0x6a655c
    });
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, L), ceilMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, H, L / 2);
    scene.add(ceiling);

    // Walls – left & right
    const wallTex = createNoiseTexture(128, 95, 88, 78, 22);
    wallTex.repeat.set(L / 2.2, H / 2.2);

    const wallMat = new THREE.MeshStandardMaterial({
      map: wallTex,
      roughness: 0.9,
      metalness: 0.03,
      color: 0xa89880
    });

    // Left wall
    const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMat);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.set(-halfW, H / 2, L / 2);
    scene.add(leftWall);

    // Right wall (clone material for independence)
    const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMat.clone());
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.position.set(halfW, H / 2, L / 2);
    scene.add(rightWall);

    // Back wall (entrance side)
    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(W, H), wallMat.clone());
    backWall.position.set(0, H / 2, 0);
    scene.add(backWall);

    // End wall (behind door)
    const endWall = new THREE.Mesh(new THREE.PlaneGeometry(W, H), wallMat.clone());
    endWall.position.set(0, H / 2, L);
    scene.add(endWall);

    // Baseboards / simple skirting for depth
    const baseMat = makeMat(0x4a4035, 0.85, 0.05);
    const baseH = 0.12;
    const leftBase = new THREE.Mesh(new THREE.BoxGeometry(0.04, baseH, L), baseMat);
    leftBase.position.set(-halfW + 0.02, baseH / 2, L / 2);
    scene.add(leftBase);
    const rightBase = new THREE.Mesh(new THREE.BoxGeometry(0.04, baseH, L), baseMat);
    rightBase.position.set(halfW - 0.02, baseH / 2, L / 2);
    scene.add(rightBase);

    // Collision boxes for walls (AABB)
    // Left wall
    addCollider(-halfW - 0.5, 0, 0, 1.0, H, L);
    // Right wall
    addCollider(halfW - 0.5, 0, 0, 1.0, H, L);
    // Back wall
    addCollider(-halfW, 0, -0.5, W, H, 1.0);
    // End wall
    addCollider(-halfW, 0, L - 0.5, W, H, 1.0);
  }

  function addCollider(x, y, z, w, h, d) {
    colliders.push({
      min: new THREE.Vector3(x, y, z),
      max: new THREE.Vector3(x + w, y + h, z + d)
    });
  }

  // ============================================================
  // FURNITURE (individual objects, easy to replace later)
  // ============================================================
  function buildFurniture() {
    // 1. Small shelf + vase (left side, early)
    createShelfAndVase(-1.35, 0, 8.5);

    // 2. Table (right side, mid)
    createTable(1.25, 0, 18);

    // 3. Framed landscape (left wall, further)
    createFramedPainting(-1.68, 1.55, 28);
  }

  function createShelfAndVase(x, y, z) {
    const group = new THREE.Group();
    group.position.set(x, y, z);

    // Shelf body
    const wood = makeMat(0x5c4a38, 0.82, 0.08);
    const darkWood = makeMat(0x3a2e22, 0.78, 0.1);

    // Vertical sides
    const sideGeo = new THREE.BoxGeometry(0.08, 0.85, 0.38);
    const leftSide = new THREE.Mesh(sideGeo, wood);
    leftSide.position.set(-0.28, 0.425, 0);
    group.add(leftSide);
    const rightSide = new THREE.Mesh(sideGeo, wood);
    rightSide.position.set(0.28, 0.425, 0);
    group.add(rightSide);

    // Shelves (3 levels)
    const shelfGeo = new THREE.BoxGeometry(0.64, 0.04, 0.4);
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(shelfGeo, darkWood);
      s.position.set(0, 0.12 + i * 0.32, 0);
      group.add(s);
    }

    // Back panel
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.85, 0.03), wood);
    back.position.set(0, 0.425, -0.18);
    group.add(back);

    // Vase on middle shelf
    const vaseMat = makeMat(0x6a5a4a, 0.55, 0.15);
    // Body (lathe-like using cylinder + scaled)
    const vaseBody = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.11, 0.22, 10),
      vaseMat
    );
    vaseBody.position.set(0, 0.55, 0.05);
    group.add(vaseBody);

    // Neck
    const neck = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.055, 0.12, 8),
      vaseMat
    );
    neck.position.set(0, 0.71, 0.05);
    group.add(neck);

    // Lip
    const lip = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.04, 0.03, 8),
      vaseMat
    );
    lip.position.set(0, 0.785, 0.05);
    group.add(lip);

    scene.add(group);

    // Collision for shelf
    addCollider(x - 0.35, 0, z - 0.22, 0.7, 0.9, 0.44);
  }

  function createTable(x, y, z) {
    const group = new THREE.Group();
    group.position.set(x, y, z);

    const wood = makeMat(0x4e3f30, 0.8, 0.06);
    const topMat = makeMat(0x5a4a38, 0.75, 0.08);

    // Table top
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.05, 0.55), topMat);
    top.position.set(0, 0.72, 0);
    group.add(top);

    // Legs
    const legGeo = new THREE.BoxGeometry(0.06, 0.7, 0.06);
    const legOffsets = [
      [-0.4, 0.35, -0.22],
      [0.4, 0.35, -0.22],
      [-0.4, 0.35, 0.22],
      [0.4, 0.35, 0.22]
    ];
    legOffsets.forEach(o => {
      const leg = new THREE.Mesh(legGeo, wood);
      leg.position.set(o[0], o[1], o[2]);
      group.add(leg);
    });

    // Simple cross brace
    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.03, 0.03), wood);
    brace.position.set(0, 0.25, 0);
    group.add(brace);

    scene.add(group);

    // Collision
    addCollider(x - 0.5, 0, z - 0.3, 1.0, 0.78, 0.6);
  }

  function createFramedPainting(x, y, z) {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.y = Math.PI / 2; // face into corridor

    // Frame
    const frameMat = makeMat(0x3a3028, 0.7, 0.12);
    const frameOuter = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.55, 0.04), frameMat);
    group.add(frameOuter);

    // Inner mat / border
    const matte = makeMat(0x2a2520, 0.9, 0.02);
    const matteMesh = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.42, 0.02), matte);
    matteMesh.position.z = 0.015;
    group.add(matteMesh);

    // Painting surface – muted landscape (procedural)
    const paintCanvas = document.createElement('canvas');
    paintCanvas.width = 128;
    paintCanvas.height = 96;
    const pctx = paintCanvas.getContext('2d');
    // Sky
    pctx.fillStyle = '#6a6e72';
    pctx.fillRect(0, 0, 128, 40);
    // Horizon hills
    pctx.fillStyle = '#4a5048';
    pctx.beginPath();
    pctx.moveTo(0, 45);
    pctx.quadraticCurveTo(40, 28, 70, 42);
    pctx.quadraticCurveTo(100, 55, 128, 38);
    pctx.lineTo(128, 96);
    pctx.lineTo(0, 96);
    pctx.fill();
    // Darker ground
    pctx.fillStyle = '#3a3830';
    pctx.fillRect(0, 62, 128, 34);
    // Subtle tree silhouette
    pctx.fillStyle = '#2a2c28';
    pctx.fillRect(88, 30, 4, 35);
    pctx.beginPath();
    pctx.arc(90, 28, 12, 0, Math.PI * 2);
    pctx.fill();

    const paintTex = new THREE.CanvasTexture(paintCanvas);
    paintTex.colorSpace = THREE.SRGBColorSpace;
    const paintMat = new THREE.MeshStandardMaterial({
      map: paintTex,
      roughness: 0.95,
      metalness: 0
    });
    const painting = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.38), paintMat);
    painting.position.z = 0.03;
    group.add(painting);

    scene.add(group);

    // Thin collider for the frame
    addCollider(x - 0.06, y - 0.3, z - 0.4, 0.12, 0.6, 0.8);
  }

  // ============================================================
  // DOOR (closed, visual only)
  // ============================================================
  function buildDoor() {
    const L = CONFIG.corridorLength;
    const group = new THREE.Group();
    group.position.set(0, 0, L - 0.08);

    const doorWood = makeMat(0x4a3c30, 0.78, 0.08);
    const frameMat = makeMat(0x3a3028, 0.75, 0.1);

    // Door frame
    const frameThick = 0.08;
    const doorW = 1.05;
    const doorH = 2.15;

    // Top
    const topFrame = new THREE.Mesh(new THREE.BoxGeometry(doorW + frameThick * 2, frameThick, 0.12), frameMat);
    topFrame.position.set(0, doorH + frameThick / 2, 0);
    group.add(topFrame);
    // Left
    const leftFrame = new THREE.Mesh(new THREE.BoxGeometry(frameThick, doorH, 0.12), frameMat);
    leftFrame.position.set(-(doorW / 2 + frameThick / 2), doorH / 2, 0);
    group.add(leftFrame);
    // Right
    const rightFrame = new THREE.Mesh(new THREE.BoxGeometry(frameThick, doorH, 0.12), frameMat);
    rightFrame.position.set(doorW / 2 + frameThick / 2, doorH / 2, 0);
    group.add(rightFrame);

    // Door panel
    const door = new THREE.Mesh(new THREE.BoxGeometry(doorW, doorH, 0.06), doorWood);
    door.position.set(0, doorH / 2, 0.01);
    group.add(door);

    // Simple panels
    const panelMat = makeMat(0x3f3328, 0.8, 0.05);
    const panel1 = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.7, 0.02), panelMat);
    panel1.position.set(-0.22, 1.5, 0.05);
    group.add(panel1);
    const panel2 = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.7, 0.02), panelMat);
    panel2.position.set(0.22, 1.5, 0.05);
    group.add(panel2);
    const panel3 = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.55, 0.02), panelMat);
    panel3.position.set(-0.22, 0.55, 0.05);
    group.add(panel3);
    const panel4 = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.55, 0.02), panelMat);
    panel4.position.set(0.22, 0.55, 0.05);
    group.add(panel4);

    // Handle
    const handleMat = makeMat(0x8a7a60, 0.4, 0.6);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.08), handleMat);
    handle.position.set(0.38, 1.0, 0.08);
    group.add(handle);

    scene.add(group);

    // Door collider (blocks passage)
    addCollider(-0.6, 0, L - 0.2, 1.2, 2.3, 0.3);
  }

  // ============================================================
  // INPUT – Touch (primary) + Keyboard/Mouse (secondary)
  // ============================================================
  function setupInput() {
    // Prevent default browser gestures
    document.body.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
    document.body.addEventListener('gesturestart', e => e.preventDefault());

    // --- Touch ---
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });

    // Joystick zone also captures
    const zone = document.getElementById('joystick-zone');
    zone.addEventListener('touchstart', onTouchStart, { passive: false });
    zone.addEventListener('touchmove', onTouchMove, { passive: false });
    zone.addEventListener('touchend', onTouchEnd, { passive: false });
    zone.addEventListener('touchcancel', onTouchEnd, { passive: false });

    // --- Keyboard (PC helper) ---
    window.addEventListener('keydown', e => {
      switch (e.code) {
        case 'KeyW': case 'ArrowUp': keys.forward = true; break;
        case 'KeyS': case 'ArrowDown': keys.back = true; break;
        case 'KeyA': case 'ArrowLeft': keys.left = true; break;
        case 'KeyD': case 'ArrowRight': keys.right = true; break;
      }
    });
    window.addEventListener('keyup', e => {
      switch (e.code) {
        case 'KeyW': case 'ArrowUp': keys.forward = false; break;
        case 'KeyS': case 'ArrowDown': keys.back = false; break;
        case 'KeyA': case 'ArrowLeft': keys.left = false; break;
        case 'KeyD': case 'ArrowRight': keys.right = false; break;
      }
    });

    // --- Mouse look (PC helper) ---
    canvas.addEventListener('mousedown', e => {
      if (e.button === 0) {
        mouseLook.active = true;
        mouseLook.lastX = e.clientX;
        mouseLook.lastY = e.clientY;
      }
    });
    window.addEventListener('mouseup', () => { mouseLook.active = false; });
    window.addEventListener('mousemove', e => {
      if (!mouseLook.active) return;
      const dx = e.clientX - mouseLook.lastX;
      const dy = e.clientY - mouseLook.lastY;
      mouseLook.lastX = e.clientX;
      mouseLook.lastY = e.clientY;
      applyLook(-dx * CONFIG.mouseSensitivity, -dy * CONFIG.mouseSensitivity);
    });
  }

  function onTouchStart(e) {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      const isLeft = t.clientX < window.innerWidth * 0.45;

      if (isLeft && !joystick.active) {
        joystick.active = true;
        joystick.id = t.identifier;
        updateJoystick(t.clientX, t.clientY);
        joystickStick.classList.add('active');
      } else if (!isLeft && !lookTouch.active) {
        lookTouch.active = true;
        lookTouch.id = t.identifier;
        lookTouch.lastX = t.clientX;
        lookTouch.lastY = t.clientY;
      }
    }
  }

  function onTouchMove(e) {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];

      if (joystick.active && t.identifier === joystick.id) {
        updateJoystick(t.clientX, t.clientY);
      } else if (lookTouch.active && t.identifier === lookTouch.id) {
        const dx = t.clientX - lookTouch.lastX;
        const dy = t.clientY - lookTouch.lastY;
        lookTouch.lastX = t.clientX;
        lookTouch.lastY = t.clientY;
        applyLook(-dx * CONFIG.lookSensitivity, -dy * CONFIG.lookSensitivity);
      }
    }
  }

  function onTouchEnd(e) {
    e.preventDefault();
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      if (joystick.active && t.identifier === joystick.id) {
        joystick.active = false;
        joystick.id = null;
        joystick.dx = 0;
        joystick.dy = 0;
        joystickStick.style.transform = 'translate(-50%, -50%)';
        joystickStick.classList.remove('active');
      }
      if (lookTouch.active && t.identifier === lookTouch.id) {
        lookTouch.active = false;
        lookTouch.id = null;
      }
    }
  }

  function updateJoystick(clientX, clientY) {
    const rect = joystickBase.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = clientX - cx;
    let dy = clientY - cy;
    const maxR = rect.width / 2 - 10;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > maxR) {
      dx = (dx / len) * maxR;
      dy = (dy / len) * maxR;
    }
    joystick.dx = dx / maxR;
    joystick.dy = dy / maxR;
    joystickStick.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  function applyLook(deltaYaw, deltaPitch) {
    player.yaw += deltaYaw;
    player.pitch += deltaPitch;
    player.pitch = Math.max(-CONFIG.pitchLimit, Math.min(CONFIG.pitchLimit, player.pitch));
  }

  // ============================================================
  // MOVEMENT & COLLISION
  // ============================================================
  function updatePlayer(dt) {
    // Movement vector in local space
    let inputX = 0;
    let inputZ = 0;

    if (joystick.active) {
      inputX = joystick.dx;
      inputZ = -joystick.dy; // forward is up on stick
    }
    if (keys.forward) inputZ += 1;
    if (keys.back) inputZ -= 1;
    if (keys.left) inputX -= 1;
    if (keys.right) inputX += 1;

    // Normalize
    const len = Math.sqrt(inputX * inputX + inputZ * inputZ);
    if (len > 1) {
      inputX /= len;
      inputZ /= len;
    }

    // World direction from yaw
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    const moveX = (inputX * cos + inputZ * sin) * CONFIG.moveSpeed * dt;
    const moveZ = (-inputX * sin + inputZ * cos) * CONFIG.moveSpeed * dt;

    // Try move with sliding
    const newPos = player.position.clone();
    newPos.x += moveX;
    newPos.z += moveZ;

    // Resolve X then Z for better sliding
    resolveCollision(newPos, 'x');
    resolveCollision(newPos, 'z');

    // Keep on floor
    newPos.y = CONFIG.eyeHeight;

    player.position.copy(newPos);

    // Update camera
    camera.position.copy(player.position);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch;
  }

  function resolveCollision(pos, axis) {
    const r = CONFIG.playerRadius;
    const y = 0.1; // check at foot level mostly
    const h = CONFIG.playerHeight - 0.3;

    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      // Expand collider by player radius
      const minX = c.min.x - r;
      const maxX = c.max.x + r;
      const minZ = c.min.z - r;
      const maxZ = c.max.z + r;
      const minY = c.min.y;
      const maxY = c.max.y;

      // Player AABB
      const pMinY = pos.y - CONFIG.eyeHeight + 0.05;
      const pMaxY = pMinY + h;

      if (pMaxY < minY || pMinY > maxY) continue;

      if (pos.x > minX && pos.x < maxX && pos.z > minZ && pos.z < maxZ) {
        if (axis === 'x') {
          const distL = pos.x - minX;
          const distR = maxX - pos.x;
          if (distL < distR) pos.x = minX;
          else pos.x = maxX;
        } else {
          const distB = pos.z - minZ;
          const distF = maxZ - pos.z;
          if (distB < distF) pos.z = minZ;
          else pos.z = maxZ;
        }
      }
    }
  }

  // ============================================================
  // RESIZE / VISIBILITY
  // ============================================================
  function onResize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  }

  function onVisibilityChange() {
    if (document.hidden) {
      clock.stop();
    } else {
      clock.start();
    }
  }

  // ============================================================
  // ANIMATION LOOP
  // ============================================================
  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05); // clamp for stability
    updatePlayer(dt);
    renderer.render(scene, camera);
  }

  // ============================================================
  // BOOT
  // ============================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
