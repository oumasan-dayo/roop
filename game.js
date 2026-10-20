/**
 * 『同じ廊下』第1段階 3D基礎プロトタイプ
 * Three.js first-person corridor for iPhone Safari
 */

(function () {
  'use strict';

  // ============================================================
  // CONFIG
  // ============================================================
  const CONFIG = {
    eyeHeight: 1.62,
    moveSpeed: 2.4,
    playerRadius: 0.32,
    playerHeight: 1.7,

    fov: 68,
    near: 0.08,
    far: 100,
    // 感度の基準値（スライダー50のとき＝現在の操作感）
    lookSensitivity: 0.0026,
    mouseSensitivity: 0.0018,
    pitchLimit: Math.PI / 2.35,

    corridorLength: 42,
    corridorWidth: 3.4,
    corridorHeight: 2.85,

    // 懐中電灯（SpotLight）
    // intensity は MeshStandardMaterial を照らすのに十分な値
    // distance 0 = 減衰距離制限なし（プレイ範囲では実質無限）
    flashlightIntensity: 14,
    flashlightDistance: 0,
    flashlightAngle: Math.PI / 5.0,
    flashlightPenumbra: 0.45,
    flashlightDecay: 1.0,

    // 通常時の明るさ（設定スライダーで上書き）
    // スライダー 0–100 → ambient 0.06–0.72 / hemi 0.04–0.45
    defaultBrightness: 65,
    ambientMin: 0.06,
    ambientMax: 0.72,
    hemiMin: 0.04,
    hemiMax: 0.45,

    // 感度スライダー初期値（50＝従来どおり）
    defaultLookSens: 50,
    defaultMoveSens: 50
  };

  const STORAGE_KEY = 'same-corridor-settings-v2';

  // ============================================================
  // STATE
  // ============================================================
  let renderer, scene, camera, clock;
  let player = {
    position: new THREE.Vector3(0, CONFIG.eyeHeight, 3.5),
    yaw: Math.PI, // 廊下の奥（+Z）を向く
    pitch: 0
  };

  const keys = { forward: false, back: false, left: false, right: false };
  let joystick = { active: false, dx: 0, dy: 0, id: null };
  let lookTouch = { active: false, id: null, lastX: 0, lastY: 0 };
  let mouseLook = { active: false, lastX: 0, lastY: 0 };

  const colliders = [];

  let flashlight;
  let ambientLight;
  let hemiLight;
  let handLightGroup = null; // 手＋懐中電灯（カメラ子）
  let settingsOpen = false;

  // 設定値（スライダー 0–100）
  let brightnessValue = CONFIG.defaultBrightness;
  let lookSensValue = CONFIG.defaultLookSens;
  let moveSensValue = CONFIG.defaultMoveSens;

  // 歩行のわずかな手ブレ用
  let bobTime = 0;
  let isMoving = false;

  const canvas = document.getElementById('game-canvas');
  const joystickBase = document.getElementById('joystick-base');
  const joystickStick = document.getElementById('joystick-stick');
  const loadingOverlay = document.getElementById('loading-overlay');
  const errorOverlay = document.getElementById('error-overlay');
  const errorMessage = document.getElementById('error-message');
  const settingsBtn = document.getElementById('settings-btn');
  const settingsPanel = document.getElementById('settings-panel');
  const settingsClose = document.getElementById('settings-close');
  const brightnessSlider = document.getElementById('brightness-slider');
  const brightnessValueEl = document.getElementById('brightness-value');
  const lookSensSlider = document.getElementById('look-sens-slider');
  const lookSensValueEl = document.getElementById('look-sens-value');
  const moveSensSlider = document.getElementById('move-sens-slider');
  const moveSensValueEl = document.getElementById('move-sens-value');

  // ============================================================
  // INIT
  // ============================================================
  function init() {
    try {
      if (!window.THREE) {
        throw new Error('Three.js の読み込みに失敗しました。ネットワーク接続を確認してください。');
      }

      loadSettings();

      clock = new THREE.Clock();

      renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: false,
        powerPreference: 'high-performance',
        alpha: false
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(window.innerWidth, window.innerHeight);
      if (THREE.SRGBColorSpace !== undefined) {
        renderer.outputColorSpace = THREE.SRGBColorSpace;
      } else if (renderer.outputEncoding !== undefined) {
        renderer.outputEncoding = THREE.sRGBEncoding;
      }
      if (THREE.ACESFilmicToneMapping !== undefined) {
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = 1.3;
      }
      renderer.shadowMap.enabled = false;

      scene = new THREE.Scene();
      scene.background = new THREE.Color(0x1a1816);
      // 遠方のドアが光で視認できる程度に弱めの霧
      scene.fog = new THREE.FogExp2(0x1a1816, 0.012);

      camera = new THREE.PerspectiveCamera(
        CONFIG.fov,
        window.innerWidth / window.innerHeight,
        CONFIG.near,
        CONFIG.far
      );
      camera.position.copy(player.position);

      setupLighting();
      buildCorridor();
      buildFurniture();
      buildDoors();
      setupInput();
      setupSettingsUI();

      window.addEventListener('resize', onResize);
      window.addEventListener('orientationchange', () => setTimeout(onResize, 150));
      document.addEventListener('visibilitychange', onVisibilityChange);

      loadingOverlay.classList.add('hidden');
      animate();

      console.log('[同じ廊下] 第1段階起動完了');
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
  // SETTINGS (明るさ・視点感度・移動感度)
  // ============================================================
  function loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (typeof data.brightness === 'number') {
          brightnessValue = clamp(data.brightness, 0, 100);
        }
        if (typeof data.lookSens === 'number') {
          lookSensValue = clamp(data.lookSens, 10, 100);
        }
        if (typeof data.moveSens === 'number') {
          moveSensValue = clamp(data.moveSens, 10, 100);
        }
      } else {
        // 旧キーからの移行
        const old = localStorage.getItem('same-corridor-brightness');
        if (old !== null) {
          const n = parseInt(old, 10);
          if (!isNaN(n)) brightnessValue = clamp(n, 0, 100);
        }
      }
    } catch (e) { /* private mode etc. */ }
  }

  function saveSettings() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        brightness: brightnessValue,
        lookSens: lookSensValue,
        moveSens: moveSensValue
      }));
    } catch (e) { /* ignore */ }
  }

  function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
  }

  function brightnessToAmbient(v) {
    const t = v / 100;
    return CONFIG.ambientMin + (CONFIG.ambientMax - CONFIG.ambientMin) * t;
  }

  function brightnessToHemi(v) {
    const t = v / 100;
    return CONFIG.hemiMin + (CONFIG.hemiMax - CONFIG.hemiMin) * t;
  }

  /** 視点感度：50＝従来値、10＝0.2倍、100＝2倍 */
  function getLookSensMult() {
    return lookSensValue / 50;
  }

  /**
   * 移動スティック感度（最大速度は変えない）
   * 50 → 線形（従来）
   * 低い → 倒し始めが鈍い（power > 1）
   * 高い → 倒し始めが敏感（power < 1）
   * |raw|===1 のとき常に 1 を返す
   */
  function applyMoveSensCurve(raw) {
    const sign = raw < 0 ? -1 : 1;
    const a = Math.abs(raw);
    if (a < 0.001) return 0;
    // moveSens 10→k=1.8, 50→k=1.0, 100→k=0.55
    const t = (moveSensValue - 10) / 90;
    const k = 1.8 - t * 1.25;
    return sign * Math.pow(a, k);
  }

  function applySettingsToUI() {
    if (ambientLight) ambientLight.intensity = brightnessToAmbient(brightnessValue);
    if (hemiLight) hemiLight.intensity = brightnessToHemi(brightnessValue);

    if (brightnessValueEl) brightnessValueEl.textContent = String(brightnessValue);
    if (brightnessSlider) brightnessSlider.value = String(brightnessValue);
    if (lookSensValueEl) lookSensValueEl.textContent = String(lookSensValue);
    if (lookSensSlider) lookSensSlider.value = String(lookSensValue);
    if (moveSensValueEl) moveSensValueEl.textContent = String(moveSensValue);
    if (moveSensSlider) moveSensSlider.value = String(moveSensValue);
  }

  function setupSettingsUI() {
    applySettingsToUI();

    settingsBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      openSettings();
    });
    settingsBtn.addEventListener('touchend', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openSettings();
    }, { passive: false });

    settingsClose.addEventListener('click', function (e) {
      e.stopPropagation();
      closeSettings();
    });
    settingsClose.addEventListener('touchend', function (e) {
      e.preventDefault();
      e.stopPropagation();
      closeSettings();
    }, { passive: false });

    settingsPanel.addEventListener('click', function (e) {
      if (e.target === settingsPanel) closeSettings();
    });

    brightnessSlider.addEventListener('input', function () {
      brightnessValue = parseInt(brightnessSlider.value, 10);
      applySettingsToUI();
      saveSettings();
    });
    lookSensSlider.addEventListener('input', function () {
      lookSensValue = parseInt(lookSensSlider.value, 10);
      applySettingsToUI();
      saveSettings();
    });
    moveSensSlider.addEventListener('input', function () {
      moveSensValue = parseInt(moveSensSlider.value, 10);
      applySettingsToUI();
      saveSettings();
    });

    settingsPanel.addEventListener('touchstart', function (e) { e.stopPropagation(); }, { passive: true });
    settingsPanel.addEventListener('touchmove', function (e) { e.stopPropagation(); }, { passive: true });
  }

  function openSettings() {
    settingsOpen = true;
    settingsPanel.classList.remove('hidden');
    joystick.active = false;
    joystick.dx = 0;
    joystick.dy = 0;
    joystick.id = null;
    joystickStick.style.transform = 'translate(-50%, -50%)';
    joystickStick.classList.remove('active');
    lookTouch.active = false;
    lookTouch.id = null;
  }

  function closeSettings() {
    settingsOpen = false;
    settingsPanel.classList.add('hidden');
  }

  // ============================================================
  // LIGHTING + 手持ち懐中電灯
  // ============================================================
  //
  // 設計方針:
  //   - 手＋本体は「見た目」用グループ（カメラ子・画面右下）
  //   - SpotLight も同じグループ内のレンズ先端に置く
  //   - 本体の長軸 = グループの -Z = ほぼカメラ前方
  //   - 毎フレーム target をグループ前方に固定し、照射方向を保証
  //
  function setupLighting() {
    ambientLight = new THREE.AmbientLight(0xb0a898, brightnessToAmbient(brightnessValue));
    scene.add(ambientLight);

    hemiLight = new THREE.HemisphereLight(0x8a8578, 0x2a2520, brightnessToHemi(brightnessValue));
    scene.add(hemiLight);

    // カメラをシーンに追加（子ライトが有効になるために必須）
    scene.add(camera);

    // 手＋懐中電灯＋SpotLight
    handLightGroup = createHandFlashlight();
    camera.add(handLightGroup);
  }

  /**
   * 一人称・画面右下の手持ち懐中電灯
   * ローカル座標: +X右 / +Y上 / -Z前（カメラ前方）
   * 本体の先端（レンズ）が -Z を向き、SpotLight も同じ方向へ照射
   */
  function createHandFlashlight() {
    const root = new THREE.Group();
    // 右下・手前。わずかに内向きにしてビームが画面中央寄りに当たる
    root.position.set(0.26, -0.30, -0.40);
    root.rotation.set(0.08, 0.18, 0.06);

    // ---------- 手 ----------
    const skin = makeMat(0xc4a888, 0.85, 0.05);
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.032, 0.09), skin);
    palm.position.set(0.01, -0.025, 0.07);
    root.add(palm);

    for (let i = 0; i < 4; i++) {
      const finger = new THREE.Mesh(new THREE.BoxGeometry(0.013, 0.016, 0.05), skin);
      finger.position.set(-0.012 + i * 0.015, 0.005, 0.03);
      finger.rotation.x = -0.6;
      root.add(finger);
    }
    const thumb = new THREE.Mesh(new THREE.BoxGeometry(0.015, 0.016, 0.038), skin);
    thumb.position.set(-0.035, -0.005, 0.055);
    thumb.rotation.set(-0.25, 0.5, 0.55);
    root.add(thumb);

    // ---------- 懐中電灯（長軸 = ローカル -Z）----------
    // Cylinder のデフォルト軸は +Y なので、X 軸 90° 回転で -Z 方向へ
    const bodyMat = makeMat(0x2c2c30, 0.4, 0.65);
    const gripMat = makeMat(0x18181a, 0.75, 0.15);
    const ringMat = makeMat(0x3c3c42, 0.35, 0.75);

    // グリップ（手元側 = +Z 寄り）
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 0.09, 10), gripMat);
    grip.rotation.x = Math.PI / 2;
    grip.position.set(0, 0, 0.05);
    root.add(grip);

    // 本体
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.018, 0.07, 12), bodyMat);
    body.rotation.x = Math.PI / 2;
    body.position.set(0, 0, -0.03);
    root.add(body);

    // ヘッドリング
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.022, 0.028, 12), ringMat);
    head.rotation.x = Math.PI / 2;
    head.position.set(0, 0, -0.08);
    root.add(head);

    // レンズ（発光）— 先端 z ≈ -0.095
    const lensMat = new THREE.MeshStandardMaterial({
      color: 0xfff8e8,
      emissive: 0xffe0a0,
      emissiveIntensity: 1.2,
      roughness: 0.25,
      metalness: 0.05
    });
    const lens = new THREE.Mesh(new THREE.CircleGeometry(0.018, 14), lensMat);
    lens.position.set(0, 0, -0.095);
    root.add(lens);

    // ---------- SpotLight：レンズ位置から前方へ ----------
    // distance=0 → 距離制限なし / decay は距離減衰の物理係数
    flashlight = new THREE.SpotLight(
      0xfff2dc,
      CONFIG.flashlightIntensity,
      CONFIG.flashlightDistance,
      CONFIG.flashlightAngle,
      CONFIG.flashlightPenumbra,
      CONFIG.flashlightDecay
    );
    flashlight.position.set(0, 0, -0.09); // レンズ直前
    // ターゲットは同じグループ内の前方（ローカル -Z）
    // root の回転によりワールドでもほぼ視線方向を向く
    flashlight.target.position.set(0, 0, -20);
    root.add(flashlight);
    root.add(flashlight.target);

    // レンズ付近のごく弱い補助（手元だけわずかに照らす）
    const tipGlow = new THREE.PointLight(0xffe8c0, 0.4, 0.5, 2);
    tipGlow.position.set(0, 0, -0.09);
    root.add(tipGlow);

    return root;
  }

  /**
   * 毎フレーム：SpotLight の照射方向を懐中電灯先端の向きに合わせる
   * （親子関係だけでも動くが、明示更新でずれを防ぐ）
   */
  function syncFlashlightBeam() {
    if (!flashlight || !handLightGroup) return;
    // target はグループローカル -Z 前方に固定済み
    // 行列を更新してワールド空間へ反映
    handLightGroup.updateMatrixWorld(true);
    if (flashlight.target) {
      flashlight.target.updateMatrixWorld(true);
    }
  }

  // ============================================================
  // MATERIALS
  // ============================================================
  function makeMat(color, roughness, metalness) {
    if (roughness === undefined) roughness = 0.92;
    if (metalness === undefined) metalness = 0.02;
    return new THREE.MeshStandardMaterial({
      color: color,
      roughness: roughness,
      metalness: metalness
    });
  }

  function createNoiseTexture(size, baseR, baseG, baseB, variance) {
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * variance;
      img.data[i]     = Math.max(0, Math.min(255, baseR + n));
      img.data[i + 1] = Math.max(0, Math.min(255, baseG + n));
      img.data[i + 2] = Math.max(0, Math.min(255, baseB + n));
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    if (THREE.SRGBColorSpace !== undefined) {
      tex.colorSpace = THREE.SRGBColorSpace;
    } else if (tex.encoding !== undefined) {
      tex.encoding = THREE.sRGBEncoding;
    }
    return tex;
  }

  // ============================================================
  // COLLIDERS
  // ============================================================
  function addCollider(x, y, z, w, h, d) {
    colliders.push({
      min: new THREE.Vector3(x, y, z),
      max: new THREE.Vector3(x + w, y + h, z + d)
    });
  }

  // ============================================================
  // CORRIDOR
  // ============================================================
  function buildCorridor() {
    const L = CONFIG.corridorLength;
    const W = CONFIG.corridorWidth;
    const H = CONFIG.corridorHeight;
    const halfW = W / 2;
    const wallThick = 0.6;

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

    // Walls
    const wallTex = createNoiseTexture(128, 95, 88, 78, 22);
    wallTex.repeat.set(L / 2.2, H / 2.2);
    const wallMat = new THREE.MeshStandardMaterial({
      map: wallTex,
      roughness: 0.9,
      metalness: 0.03,
      color: 0xa89880
    });

    const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMat);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.set(-halfW, H / 2, L / 2);
    scene.add(leftWall);

    const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMat.clone());
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.position.set(halfW, H / 2, L / 2);
    scene.add(rightWall);

    // 入口側・奥側の壁（ドア穴はドアオブジェクトで塞ぐ）
    const backWall = new THREE.Mesh(new THREE.PlaneGeometry(W, H), wallMat.clone());
    backWall.position.set(0, H / 2, 0);
    scene.add(backWall);

    const endWall = new THREE.Mesh(new THREE.PlaneGeometry(W, H), wallMat.clone());
    endWall.position.set(0, H / 2, L);
    scene.add(endWall);

    // Baseboards
    const baseMat = makeMat(0x4a4035, 0.85, 0.05);
    const baseH = 0.12;
    const leftBase = new THREE.Mesh(new THREE.BoxGeometry(0.04, baseH, L), baseMat);
    leftBase.position.set(-halfW + 0.02, baseH / 2, L / 2);
    scene.add(leftBase);
    const rightBase = new THREE.Mesh(new THREE.BoxGeometry(0.04, baseH, L), baseMat);
    rightBase.position.set(halfW - 0.02, baseH / 2, L / 2);
    scene.add(rightBase);

    // ---- 衝突判定（壁の外側にソリッドを置き、内側へはみ出さない）----
    // 左壁: 表面 x = -halfW
    addCollider(-halfW - wallThick, 0, -1, wallThick, H, L + 2);
    // 右壁: 表面 x = +halfW
    addCollider(halfW, 0, -1, wallThick, H, L + 2);
    // 入口側 (z=0)
    addCollider(-halfW - wallThick, 0, -wallThick, W + wallThick * 2, H, wallThick);
    // 奥側 (z=L)
    addCollider(-halfW - wallThick, 0, L, W + wallThick * 2, H, wallThick);
  }

  // ============================================================
  // FURNITURE
  // ============================================================
  function buildFurniture() {
    createShelfAndVase(-1.35, 0, 8.5);
    createTable(1.25, 0, 18);
    createFramedPainting(-1.68, 1.55, 28);
  }

  function createShelfAndVase(x, y, z) {
    const group = new THREE.Group();
    group.position.set(x, y, z);

    const wood = makeMat(0x5c4a38, 0.82, 0.08);
    const darkWood = makeMat(0x3a2e22, 0.78, 0.1);

    const sideGeo = new THREE.BoxGeometry(0.08, 0.85, 0.38);
    const leftSide = new THREE.Mesh(sideGeo, wood);
    leftSide.position.set(-0.28, 0.425, 0);
    group.add(leftSide);
    const rightSide = new THREE.Mesh(sideGeo, wood);
    rightSide.position.set(0.28, 0.425, 0);
    group.add(rightSide);

    const shelfGeo = new THREE.BoxGeometry(0.64, 0.04, 0.4);
    for (let i = 0; i < 3; i++) {
      const s = new THREE.Mesh(shelfGeo, darkWood);
      s.position.set(0, 0.12 + i * 0.32, 0);
      group.add(s);
    }

    const back = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.85, 0.03), wood);
    back.position.set(0, 0.425, -0.18);
    group.add(back);

    const vaseMat = makeMat(0x6a5a4a, 0.55, 0.15);
    const vaseBody = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.11, 0.22, 10), vaseMat);
    vaseBody.position.set(0, 0.55, 0.05);
    group.add(vaseBody);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, 0.12, 8), vaseMat);
    neck.position.set(0, 0.71, 0.05);
    group.add(neck);
    const lip = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.04, 0.03, 8), vaseMat);
    lip.position.set(0, 0.785, 0.05);
    group.add(lip);

    scene.add(group);
    addCollider(x - 0.35, 0, z - 0.22, 0.7, 0.9, 0.44);
  }

  function createTable(x, y, z) {
    const group = new THREE.Group();
    group.position.set(x, y, z);

    const wood = makeMat(0x4e3f30, 0.8, 0.06);
    const topMat = makeMat(0x5a4a38, 0.75, 0.08);

    const top = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.05, 0.55), topMat);
    top.position.set(0, 0.72, 0);
    group.add(top);

    const legGeo = new THREE.BoxGeometry(0.06, 0.7, 0.06);
    [[-0.4, 0.35, -0.22], [0.4, 0.35, -0.22], [-0.4, 0.35, 0.22], [0.4, 0.35, 0.22]].forEach(function (o) {
      const leg = new THREE.Mesh(legGeo, wood);
      leg.position.set(o[0], o[1], o[2]);
      group.add(leg);
    });

    const brace = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.03, 0.03), wood);
    brace.position.set(0, 0.25, 0);
    group.add(brace);

    scene.add(group);
    addCollider(x - 0.5, 0, z - 0.3, 1.0, 0.78, 0.6);
  }

  function createFramedPainting(x, y, z) {
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.y = Math.PI / 2;

    const frameMat = makeMat(0x3a3028, 0.7, 0.12);
    group.add(new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.55, 0.04), frameMat));

    const matte = makeMat(0x2a2520, 0.9, 0.02);
    const matteMesh = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.42, 0.02), matte);
    matteMesh.position.z = 0.015;
    group.add(matteMesh);

    const paintCanvas = document.createElement('canvas');
    paintCanvas.width = 128;
    paintCanvas.height = 96;
    const pctx = paintCanvas.getContext('2d');
    pctx.fillStyle = '#6a6e72';
    pctx.fillRect(0, 0, 128, 40);
    pctx.fillStyle = '#4a5048';
    pctx.beginPath();
    pctx.moveTo(0, 45);
    pctx.quadraticCurveTo(40, 28, 70, 42);
    pctx.quadraticCurveTo(100, 55, 128, 38);
    pctx.lineTo(128, 96);
    pctx.lineTo(0, 96);
    pctx.fill();
    pctx.fillStyle = '#3a3830';
    pctx.fillRect(0, 62, 128, 34);
    pctx.fillStyle = '#2a2c28';
    pctx.fillRect(88, 30, 4, 35);
    pctx.beginPath();
    pctx.arc(90, 28, 12, 0, Math.PI * 2);
    pctx.fill();

    const paintTex = new THREE.CanvasTexture(paintCanvas);
    if (THREE.SRGBColorSpace !== undefined) {
      paintTex.colorSpace = THREE.SRGBColorSpace;
    } else if (paintTex.encoding !== undefined) {
      paintTex.encoding = THREE.sRGBEncoding;
    }
    const paintMat = new THREE.MeshStandardMaterial({
      map: paintTex,
      roughness: 0.95,
      metalness: 0
    });
    const painting = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.38), paintMat);
    painting.position.z = 0.03;
    group.add(painting);

    scene.add(group);
    addCollider(x - 0.06, y - 0.3, z - 0.4, 0.12, 0.6, 0.8);
  }

  // ============================================================
  // DOORS（手前・奥を別管理）
  // ============================================================
  function buildDoors() {
    // 奥のドア（+Z 端）— 廊下内側を向く（プレイヤーから見える）
    createDoor('front', CONFIG.corridorLength - 0.08, false);
    // 入口側のドア（-Z 端）— 廊下内側を向く
    createDoor('back', 0.08, true);
  }

  /**
   * @param {string} id - 'front' | 'back'（後続ループ用に識別）
   * @param {number} z - 配置 Z
   * @param {boolean} flip - true なら Y 軸 180° 回転（入口側）
   */
  function createDoor(id, z, flip) {
    const group = new THREE.Group();
    group.name = 'door_' + id;
    group.position.set(0, 0, z);
    if (flip) group.rotation.y = Math.PI;

    const doorWood = makeMat(0x4a3c30, 0.78, 0.08);
    const frameMat = makeMat(0x3a3028, 0.75, 0.1);
    const frameThick = 0.08;
    const doorW = 1.05;
    const doorH = 2.15;

    const topFrame = new THREE.Mesh(
      new THREE.BoxGeometry(doorW + frameThick * 2, frameThick, 0.12),
      frameMat
    );
    topFrame.position.set(0, doorH + frameThick / 2, 0);
    group.add(topFrame);

    const leftFrame = new THREE.Mesh(new THREE.BoxGeometry(frameThick, doorH, 0.12), frameMat);
    leftFrame.position.set(-(doorW / 2 + frameThick / 2), doorH / 2, 0);
    group.add(leftFrame);

    const rightFrame = new THREE.Mesh(new THREE.BoxGeometry(frameThick, doorH, 0.12), frameMat);
    rightFrame.position.set(doorW / 2 + frameThick / 2, doorH / 2, 0);
    group.add(rightFrame);

    const door = new THREE.Mesh(new THREE.BoxGeometry(doorW, doorH, 0.06), doorWood);
    door.position.set(0, doorH / 2, 0.01);
    group.add(door);

    const panelMat = makeMat(0x3f3328, 0.8, 0.05);
    [[-0.22, 1.5], [0.22, 1.5], [-0.22, 0.55], [0.22, 0.55]].forEach(function (p, i) {
      const h = i < 2 ? 0.7 : 0.55;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.38, h, 0.02), panelMat);
      panel.position.set(p[0], p[1], 0.05);
      group.add(panel);
    });

    const handleMat = makeMat(0x8a7a60, 0.4, 0.6);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.08), handleMat);
    handle.position.set(0.38, 1.0, 0.08);
    group.add(handle);

    scene.add(group);

    // 当たり判定（通り抜け不可）
    // flip の有無に関わらず Z 付近をブロック
    addCollider(-0.65, 0, z - 0.15, 1.3, 2.35, 0.35);
  }

  // ============================================================
  // INPUT
  // ============================================================
  function setupInput() {
    document.body.addEventListener('touchmove', function (e) {
      if (!settingsOpen) e.preventDefault();
    }, { passive: false });
    document.body.addEventListener('gesturestart', function (e) { e.preventDefault(); });

    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', onTouchEnd, { passive: false });
    canvas.addEventListener('touchcancel', onTouchEnd, { passive: false });

    const zone = document.getElementById('joystick-zone');
    zone.addEventListener('touchstart', onTouchStart, { passive: false });
    zone.addEventListener('touchmove', onTouchMove, { passive: false });
    zone.addEventListener('touchend', onTouchEnd, { passive: false });
    zone.addEventListener('touchcancel', onTouchEnd, { passive: false });

    window.addEventListener('keydown', function (e) {
      if (settingsOpen) return;
      switch (e.code) {
        case 'KeyW': case 'ArrowUp': keys.forward = true; break;
        case 'KeyS': case 'ArrowDown': keys.back = true; break;
        case 'KeyA': case 'ArrowLeft': keys.left = true; break;
        case 'KeyD': case 'ArrowRight': keys.right = true; break;
      }
    });
    window.addEventListener('keyup', function (e) {
      switch (e.code) {
        case 'KeyW': case 'ArrowUp': keys.forward = false; break;
        case 'KeyS': case 'ArrowDown': keys.back = false; break;
        case 'KeyA': case 'ArrowLeft': keys.left = false; break;
        case 'KeyD': case 'ArrowRight': keys.right = false; break;
      }
    });

    canvas.addEventListener('mousedown', function (e) {
      if (settingsOpen || e.button !== 0) return;
      mouseLook.active = true;
      mouseLook.lastX = e.clientX;
      mouseLook.lastY = e.clientY;
    });
    window.addEventListener('mouseup', function () { mouseLook.active = false; });
    window.addEventListener('mousemove', function (e) {
      if (!mouseLook.active || settingsOpen) return;
      const dx = e.clientX - mouseLook.lastX;
      const dy = e.clientY - mouseLook.lastY;
      mouseLook.lastX = e.clientX;
      mouseLook.lastY = e.clientY;
      const m = getLookSensMult();
      applyLook(-dx * CONFIG.mouseSensitivity * m, -dy * CONFIG.mouseSensitivity * m);
    });
  }

  function onTouchStart(e) {
    if (settingsOpen) return;
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
    if (settingsOpen) return;
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
        const m = getLookSensMult();
        applyLook(-dx * CONFIG.lookSensitivity * m, -dy * CONFIG.lookSensitivity * m);
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
    joystickStick.style.transform = 'translate(calc(-50% + ' + dx + 'px), calc(-50% + ' + dy + 'px))';
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
    if (settingsOpen) {
      // 設定中もカメラ位置は同期
      camera.position.copy(player.position);
      camera.rotation.order = 'YXZ';
      camera.rotation.y = player.yaw;
      camera.rotation.x = player.pitch;
      camera.rotation.z = 0;
      return;
    }

    let inputX = 0;
    let inputZ = 0;

    if (joystick.active) {
      // 感度カーブ適用（最大倒し時は常に ±1 → 最大速度は不変）
      inputX = applyMoveSensCurve(joystick.dx);
      // スティック上（dy < 0）→ 前進（inputZ > 0）
      inputZ = applyMoveSensCurve(-joystick.dy);
    }
    if (keys.forward) inputZ += 1;
    if (keys.back) inputZ -= 1;
    if (keys.left) inputX -= 1;
    if (keys.right) inputX += 1;

    const len = Math.sqrt(inputX * inputX + inputZ * inputZ);
    if (len > 1) {
      inputX /= len;
      inputZ /= len;
    }

    // Three.js YXZ:
    //   yaw=0 → -Z, yaw=π → +Z
    //   forward = (-sin(yaw), 0, -cos(yaw))
    //   right   = ( cos(yaw), 0, -sin(yaw))
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);

    const moveX = (-sin * inputZ + cos * inputX) * CONFIG.moveSpeed * dt;
    const moveZ = (-cos * inputZ - sin * inputX) * CONFIG.moveSpeed * dt;

    const newPos = player.position.clone();
    newPos.x += moveX;
    newPos.z += moveZ;

    resolveCollision(newPos, 'x');
    resolveCollision(newPos, 'z');

    // 安全クランプ：廊下内に強制拘束（すり抜け防止）
    const halfW = CONFIG.corridorWidth / 2;
    const margin = CONFIG.playerRadius + 0.04;
    newPos.x = Math.max(-halfW + margin, Math.min(halfW - margin, newPos.x));
    newPos.z = Math.max(margin + 0.1, Math.min(CONFIG.corridorLength - margin - 0.1, newPos.z));
    newPos.y = CONFIG.eyeHeight;

    player.position.copy(newPos);

    camera.position.copy(player.position);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch;
    camera.rotation.z = 0;

    // 歩行中のさりげない手持ち揺れ（カメラ自体は揺らさない）
    isMoving = len > 0.05;
    updateHandBob(dt);
  }

  function updateHandBob(dt) {
    if (!handLightGroup) return;
    if (isMoving) {
      bobTime += dt * 7.5;
    } else {
      bobTime *= 0.92;
    }
    const bobY = Math.sin(bobTime) * 0.006;
    const bobX = Math.sin(bobTime * 0.5) * 0.003;
    // createHandFlashlight の基準位置と一致させる
    handLightGroup.position.set(0.26 + bobX, -0.30 + bobY, -0.40);
  }

  function resolveCollision(pos, axis) {
    const r = CONFIG.playerRadius;
    const h = CONFIG.playerHeight - 0.25;

    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      const minX = c.min.x - r;
      const maxX = c.max.x + r;
      const minZ = c.min.z - r;
      const maxZ = c.max.z + r;

      const pMinY = pos.y - CONFIG.eyeHeight + 0.05;
      const pMaxY = pMinY + h;
      if (pMaxY < c.min.y || pMinY > c.max.y) continue;

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
  // RESIZE / VISIBILITY / LOOP
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
    if (document.hidden) clock.stop();
    else clock.start();
  }

  function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.05);
    updatePlayer(dt);
    syncFlashlightBeam();
    renderer.render(scene, camera);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
