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
    moveSpeed: 2.7,
    dashMultiplier: 1.7,
    playerRadius: 0.28,
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
  let playBounds = { halfW: 1.7, zMin: 0.35, zMinOpen: -0.4, zMaxClosed: 41.5, zMaxOpen: 46.5 };
  let entranceBlockCollider = null; // 入口中央（後方ドア閉鎖時に塞ぐ）

  let flashlight;
  let ambientLight;
  let hemiLight;
  let handLightGroup = null;
  let settingsOpen = false;
  let gameState = 'title'; // 'title' | 'howto' | 'intro' | 'playing'
  let settingsReturnTo = 'title';
  let loopCount = 1; // 初回探索は1周目
  let loopInProgress = false;
  let introIndex = 0;
  const INTRO_LINES = [
    '……ここは、どこだ？',
    '気がつくと、見知らぬ廊下に立っていた。',
    '前方に、ドアが見える。',
    '……あそこから出られるはずだ。',
    '出口へ向かおう。'
  ];

  // 3周目イベント / 謎解き
  let vaseMesh = null;
  let vaseFallState = null; // { active, vy, done }
  let vaseEventTriggered = false;
  let paperSpawned = false;
  let puzzleStarted = false;
  let puzzleSolved = false;
  const PUZZLE_ANSWER = ['up', 'down', 'down', 'up'];
  let puzzleInput = [];
  let lastPassDir = null;
  let backDoorState = null;
  let messageQueue = [];
  let loopPassDirection = 'up'; // 今回の通過方向

  // ダッシュ / 体力
  let dashHeld = false;
  let stamina = 100;
  const STAMINA_MAX = 100;
  const STAMINA_DRAIN = 28; // /sec
  const STAMINA_REGEN = 20; // /sec
  const STAMINA_REGEN_DELAY = 1.5;
  let staminaRegenTimer = 0;
  let isDashing = false;

  // ---- 探索システム ----
  const interactables = []; // { id, kind, label, message, position, radius, hitMesh, inspected }
  const inspectedSet = {};
  let allInspectedNarrationShown = false;
  let messageOpen = false;
  let currentTarget = null; // interactable or null
  let raycaster = null;
  let frontDoorState = null; // { pivot, collider, open, animating, angle }
  let doorOpen = false;

  // 設定値（スライダー 0–100）
  let brightnessValue = CONFIG.defaultBrightness;
  let lookSensValue = CONFIG.defaultLookSens;
  let moveSensValue = CONFIG.defaultMoveSens;

  // 歩行のわずかな手ブレ用
  let bobTime = 0;
  let isMoving = false;
  let headBobTime = 0;
  let headBobAmount = 0;

  // ストーリー進行（loopCount・ドア通過回数とは独立）
  // 1:導入探索 / 2:違和感＋薄い異変 / 3:花瓶・暗号＋異変増 / 4:日記・金庫 / 5+:さらに増
  let storyStage = 1;
  let anomalyLevel = 0;
  let loop4Spawned = false;
  // 金庫: painting → code → opening → key_msg → done
  let safeState = 'painting';
  let safeOpened = false;
  let hasKey = false;
  let safeObject = null;
  let keyObject = null;
  let pinOpen = false;
  let pinInput = '';
  let paintingCenterGroup = null;
  let anomalyRoot = null;
  // 花瓶演出
  let vaseCinematic = false;
  let vaseCinePhase = 0;
  let vaseCineTimer = 0;
  let vaseLookTarget = new THREE.Vector3();
  let savedYaw = 0;
  let savedPitch = 0;
  let messageNextMode = null;

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
      setupExplorationUI();

      window.addEventListener('resize', onResize);
      window.addEventListener('orientationchange', () => setTimeout(onResize, 150));
      document.addEventListener('visibilitychange', onVisibilityChange);

      loadingOverlay.classList.add('hidden');
      setupTitleUI();
      setupDashUI();
      setupPinUI();
      showTitleScreen();
      animate();

      console.log('[同じ廊下] 起動完了');
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
    settingsReturnTo = gameState;
    settingsPanel.classList.remove('hidden');
    settingsPanel.style.zIndex = '100';
    const ts = document.getElementById('title-screen');
    if (ts) ts.style.pointerEvents = 'none';
    joystick.active = false;
    joystick.dx = 0;
    joystick.dy = 0;
    joystick.id = null;
    joystickStick.style.transform = 'translate(-50%, -50%)';
    joystickStick.classList.remove('active');
    lookTouch.active = false;
    lookTouch.id = null;
    dashHeld = false;
    isDashing = false;
    const db = document.getElementById('dash-btn');
    if (db) db.classList.remove('active');
  }

  function closeSettings() {
    settingsOpen = false;
    settingsPanel.classList.add('hidden');
    const ts = document.getElementById('title-screen');
    if (ts) ts.style.pointerEvents = '';
    // ゲームは開始しない。settingsReturnTo が title ならタイトルのまま
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
  // MATERIALS & PROCEDURAL TEXTURES
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

  function applyTexColorSpace(tex) {
    if (THREE.SRGBColorSpace !== undefined) {
      tex.colorSpace = THREE.SRGBColorSpace;
    } else if (tex.encoding !== undefined) {
      tex.encoding = THREE.sRGBEncoding;
    }
    return tex;
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
    return applyTexColorSpace(tex);
  }

  /** 古い床板テクスチャ */
  function createWoodFloorTexture(size) {
    size = size || 256;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#6e5e48';
    ctx.fillRect(0, 0, size, size);
    const plankH = size / 8;
    for (let row = 0; row < 8; row++) {
      const y = row * plankH;
      const base = 95 + (row % 3) * 8 + Math.random() * 10;
      ctx.fillStyle = 'rgb(' + (base + 10) + ',' + (base - 5) + ',' + (base - 25) + ')';
      ctx.fillRect(0, y, size, plankH - 1);
      // 木目
      for (let i = 0; i < 12; i++) {
        const gx = Math.random() * size;
        ctx.strokeStyle = 'rgba(40,30,18,' + (0.08 + Math.random() * 0.12) + ')';
        ctx.beginPath();
        ctx.moveTo(gx, y + 2);
        ctx.bezierCurveTo(gx + 20, y + plankH * 0.4, gx - 15, y + plankH * 0.7, gx + 10, y + plankH - 2);
        ctx.stroke();
      }
      // 継ぎ目
      ctx.fillStyle = 'rgba(30,22,14,0.55)';
      ctx.fillRect(0, y + plankH - 1.5, size, 1.5);
      // 傷
      if (Math.random() > 0.5) {
        ctx.strokeStyle = 'rgba(20,15,10,0.2)';
        ctx.beginPath();
        ctx.moveTo(Math.random() * size, y + Math.random() * plankH);
        ctx.lineTo(Math.random() * size, y + Math.random() * plankH);
        ctx.stroke();
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = 4;
    return applyTexColorSpace(tex);
  }

  /** 壁紙／古い塗装 */
  function createWallTexture(size) {
    size = size || 256;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#a89880';
    ctx.fillRect(0, 0, size, size);
    // ノイズ
    const img = ctx.getImageData(0, 0, size, size);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 28;
      img.data[i] = Math.max(0, Math.min(255, img.data[i] + n));
      img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n * 0.9));
      img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n * 0.7));
    }
    ctx.putImageData(img, 0, 0);
    // 縦の染み
    for (let i = 0; i < 8; i++) {
      const x = Math.random() * size;
      const grd = ctx.createLinearGradient(x, 0, x, size);
      grd.addColorStop(0, 'rgba(80,70,55,0)');
      grd.addColorStop(0.4, 'rgba(70,60,45,0.12)');
      grd.addColorStop(1, 'rgba(50,40,30,0.18)');
      ctx.fillStyle = grd;
      ctx.fillRect(x, 0, 8 + Math.random() * 20, size);
    }
    // 細かい模様
    ctx.strokeStyle = 'rgba(90,80,65,0.06)';
    for (let y = 0; y < size; y += 16) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(size, y);
      ctx.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return applyTexColorSpace(tex);
  }

  /** 家具用木目 */
  function createFurnitureWoodTexture(size, tone) {
    size = size || 128;
    tone = tone || 0;
    const c = document.createElement('canvas');
    c.width = size;
    c.height = size;
    const ctx = c.getContext('2d');
    const br = 90 + tone;
    const bg = 70 + tone * 0.7;
    const bb = 48 + tone * 0.4;
    ctx.fillStyle = 'rgb(' + br + ',' + bg + ',' + bb + ')';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 40; i++) {
      const y = Math.random() * size;
      ctx.strokeStyle = 'rgba(' + (40 + tone) + ',' + (28 + tone * 0.5) + ',12,' + (0.1 + Math.random() * 0.2) + ')';
      ctx.lineWidth = 0.5 + Math.random();
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x < size; x += 8) {
        ctx.lineTo(x, y + Math.sin(x * 0.1 + i) * 3);
      }
      ctx.stroke();
    }
    // 汚れ
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = 'rgba(30,20,10,' + (0.05 + Math.random() * 0.1) + ')';
      ctx.beginPath();
      ctx.ellipse(Math.random() * size, Math.random() * size, 4 + Math.random() * 12, 2 + Math.random() * 6, Math.random(), 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return applyTexColorSpace(tex);
  }

  /** 風景画テクスチャ */
  function createLandscapePaintingTexture(variant) {
    variant = variant || 0;
    const w = 256;
    const h = 192;
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');

    if (variant === 1) {
      // 古い建物のシルエット
      const sky = ctx.createLinearGradient(0, 0, 0, h);
      sky.addColorStop(0, '#3a3e48');
      sky.addColorStop(0.5, '#5a5860');
      sky.addColorStop(1, '#2a2828');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#1a1816';
      ctx.fillRect(w * 0.28, h * 0.22, w * 0.44, h * 0.55);
      ctx.fillRect(w * 0.22, h * 0.38, w * 0.12, h * 0.4);
      ctx.fillRect(w * 0.66, h * 0.35, w * 0.14, h * 0.42);
      // 窓の光
      ctx.fillStyle = 'rgba(200,180,120,0.35)';
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 3; col++) {
          ctx.fillRect(w * 0.32 + col * 28, h * 0.3 + row * 28, 14, 16);
        }
      }
      ctx.fillStyle = 'rgba(180,150,80,0.1)';
      ctx.fillRect(0, 0, w, h);
    } else if (variant === 2) {
      // 曇天の風景
      const sky = ctx.createLinearGradient(0, 0, 0, h * 0.5);
      sky.addColorStop(0, '#6a6e78');
      sky.addColorStop(1, '#9a9aa0');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h * 0.5);
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath();
      ctx.ellipse(w * 0.3, h * 0.2, 50, 18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(w * 0.65, h * 0.15, 60, 22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4a4e48';
      ctx.beginPath();
      ctx.moveTo(0, h * 0.48);
      ctx.lineTo(w * 0.4, h * 0.42);
      ctx.lineTo(w, h * 0.5);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.fill();
      ctx.fillStyle = '#3a3e38';
      ctx.fillRect(0, h * 0.7, w, h * 0.3);
      ctx.fillStyle = 'rgba(160,140,100,0.12)';
      ctx.fillRect(0, 0, w, h);
    } else {
      // 霧の森（variant 0）
      const sky = ctx.createLinearGradient(0, 0, 0, h * 0.45);
      sky.addColorStop(0, '#5a6570');
      sky.addColorStop(1, '#8a9098');
      ctx.fillStyle = sky;
      ctx.fillRect(0, 0, w, h * 0.45);
      ctx.fillStyle = '#4a5550';
      ctx.beginPath();
      ctx.moveTo(0, h * 0.42);
      ctx.quadraticCurveTo(w * 0.25, h * 0.28, w * 0.5, h * 0.4);
      ctx.quadraticCurveTo(w * 0.75, h * 0.32, w, h * 0.38);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.fill();
      ctx.fillStyle = '#3a4538';
      ctx.beginPath();
      ctx.moveTo(0, h * 0.55);
      ctx.quadraticCurveTo(w * 0.3, h * 0.48, w * 0.6, h * 0.58);
      ctx.quadraticCurveTo(w * 0.85, h * 0.62, w, h * 0.52);
      ctx.lineTo(w, h);
      ctx.lineTo(0, h);
      ctx.fill();
      const water = ctx.createLinearGradient(0, h * 0.62, 0, h * 0.78);
      water.addColorStop(0, '#3a4850');
      water.addColorStop(1, '#2a353c');
      ctx.fillStyle = water;
      ctx.fillRect(0, h * 0.62, w, h * 0.16);
      ctx.fillStyle = '#2a3228';
      ctx.fillRect(0, h * 0.75, w, h * 0.25);
      for (let i = 0; i < 18; i++) {
        const tx = (i / 18) * w + (i % 3) * 2;
        const th = 20 + (i % 5) * 7;
        ctx.fillStyle = 'rgb(' + (30 + i) + ',' + (38 + i) + ',' + (28 + (i % 4)) + ')';
        ctx.beginPath();
        ctx.moveTo(tx, h * 0.78);
        ctx.lineTo(tx - 8, h * 0.78 - th * 0.5);
        ctx.lineTo(tx, h * 0.78 - th);
        ctx.lineTo(tx + 8, h * 0.78 - th * 0.5);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(180,150,80,0.12)';
      ctx.fillRect(0, 0, w, h);
    }
    // 共通のひび・枠影
    ctx.strokeStyle = 'rgba(40,35,30,0.15)';
    ctx.beginPath();
    ctx.moveTo(w * 0.3, 10);
    ctx.lineTo(w * 0.35, h * 0.4);
    ctx.lineTo(w * 0.28, h * 0.7);
    ctx.stroke();
    const tex = new THREE.CanvasTexture(c);
    return applyTexColorSpace(tex);
  }

  // ============================================================
  // COLLIDERS
  // ============================================================
  function addCollider(x, y, z, w, h, d) {
    const c = {
      min: new THREE.Vector3(x, y, z),
      max: new THREE.Vector3(x + w, y + h, z + d),
      active: true
    };
    colliders.push(c);
    return c;
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

    // Floor — 古い板張り
    const floorTex = createWoodFloorTexture(256);
    floorTex.repeat.set(L / 3.2, W / 3.2);
    const floorMat = new THREE.MeshStandardMaterial({
      map: floorTex,
      roughness: 0.82,
      metalness: 0.05,
      color: 0xc4b49a
    });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, L), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, L / 2);
    scene.add(floor);

    // Ceiling
    const ceilTex = createNoiseTexture(128, 58, 55, 50, 14);
    ceilTex.repeat.set(L / 2.5, W / 2.5);
    const ceilMat = new THREE.MeshStandardMaterial({
      map: ceilTex,
      roughness: 0.94,
      metalness: 0.0,
      color: 0x7a7468
    });
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(W, L), ceilMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.set(0, H, L / 2);
    scene.add(ceiling);

    // Walls — 古い壁紙
    const wallTex = createWallTexture(256);
    wallTex.repeat.set(L / 3.5, H / 2.8);
    const wallMat = new THREE.MeshStandardMaterial({
      map: wallTex,
      roughness: 0.88,
      metalness: 0.02,
      color: 0xc8bca8
    });

    const leftWall = new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMat);
    leftWall.rotation.y = Math.PI / 2;
    leftWall.position.set(-halfW, H / 2, L / 2);
    scene.add(leftWall);

    const rightWall = new THREE.Mesh(new THREE.PlaneGeometry(L, H), wallMat.clone());
    rightWall.rotation.y = -Math.PI / 2;
    rightWall.position.set(halfW, H / 2, L / 2);
    scene.add(rightWall);

    // 入口側の壁
    const doorGap = 1.15;
    const sideW = (W - doorGap) / 2;

    // 入口側の壁：左右＋ドア上部を壁材で連続させる（黒い穴を作らない）
    const doorOpeningH = 2.23; // ドア＋枠の高さに合わせる
    if (sideW > 0.05) {
      const backLeft = new THREE.Mesh(new THREE.PlaneGeometry(sideW, H), wallMat.clone());
      backLeft.position.set(-halfW + sideW / 2, H / 2, 0);
      scene.add(backLeft);
      const backRight = new THREE.Mesh(new THREE.PlaneGeometry(sideW, H), wallMat.clone());
      backRight.position.set(halfW - sideW / 2, H / 2, 0);
      scene.add(backRight);
    }
    // ドア上部の壁（天井まで）
    const headerH = Math.max(0.2, H - doorOpeningH);
    const backHeader = new THREE.Mesh(
      new THREE.PlaneGeometry(doorGap + 0.08, headerH),
      wallMat.clone()
    );
    backHeader.position.set(0, doorOpeningH + headerH / 2, 0.01);
    scene.add(backHeader);
    // 開口の奥はドア高さ分だけ黒（上部は壁で覆う）
    const backVoid = new THREE.Mesh(
      new THREE.PlaneGeometry(doorGap + 0.1, doorOpeningH),
      new THREE.MeshBasicMaterial({ color: 0x000000 })
    );
    backVoid.position.set(0, doorOpeningH / 2, -0.04);
    scene.add(backVoid);

    // 奥壁：開口を残して左右分割
    if (sideW > 0.05) {
      const endLeft = new THREE.Mesh(new THREE.PlaneGeometry(sideW, H), wallMat.clone());
      endLeft.position.set(-halfW + sideW / 2, H / 2, L);
      scene.add(endLeft);
      const endRight = new THREE.Mesh(new THREE.PlaneGeometry(sideW, H), wallMat.clone());
      endRight.position.set(halfW - sideW / 2, H / 2, L);
      scene.add(endRight);
    }

    // ドア開口の奥は完全な黒（MeshBasicMaterial・照明の影響なし）
    const extLen = 4;
    const voidMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    // 開口を覆う黒壁（枠のすぐ奥）
    const voidPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(doorGap + 0.15, H + 0.1),
      voidMat
    );
    voidPlane.position.set(0, H / 2, L + 0.04);
    scene.add(voidPlane);
    // 奥行きのある黒空間（上下左右も黒で漏れ防止）
    const voidDepth = 3.5;
    const voidBox = new THREE.Mesh(
      new THREE.BoxGeometry(doorGap + 0.3, H + 0.2, voidDepth),
      voidMat
    );
    voidBox.position.set(0, H / 2, L + 0.04 + voidDepth / 2);
    scene.add(voidBox);
    // 通過用の床コリジョンのみ（見た目は黒）
    const voidFloorCol = new THREE.Mesh(
      new THREE.PlaneGeometry(doorGap, voidDepth),
      voidMat
    );
    voidFloorCol.rotation.x = -Math.PI / 2;
    voidFloorCol.position.set(0, 0.001, L + voidDepth / 2);
    scene.add(voidFloorCol);

    // 巾木（立体）
    const baseWood = createFurnitureWoodTexture(64, -10);
    const baseMat = new THREE.MeshStandardMaterial({
      map: baseWood,
      roughness: 0.8,
      metalness: 0.06,
      color: 0x8a7a65
    });
    const baseH = 0.14;
    const leftBase = new THREE.Mesh(new THREE.BoxGeometry(0.06, baseH, L), baseMat);
    leftBase.position.set(-halfW + 0.03, baseH / 2, L / 2);
    scene.add(leftBase);
    const rightBase = new THREE.Mesh(new THREE.BoxGeometry(0.06, baseH, L), baseMat);
    rightBase.position.set(halfW - 0.03, baseH / 2, L / 2);
    scene.add(rightBase);
    // 入口・奥の巾木
    const backBase = new THREE.Mesh(new THREE.BoxGeometry(W, baseH, 0.05), baseMat);
    backBase.position.set(0, baseH / 2, 0.03);
    scene.add(backBase);

    // ---- 衝突判定 ----
    addCollider(-halfW - wallThick, 0, -1, wallThick, H, L + extLen + 2);
    addCollider(halfW, 0, -1, wallThick, H, L + extLen + 2);

    // 入口：開口左右の壁は常時衝突。中央はドア用コリジョンで塞ぐ
    if (sideW > 0.05) {
      addCollider(-halfW - wallThick, 0, -wallThick, sideW + wallThick, H, wallThick);
      addCollider(halfW - sideW, 0, -wallThick, sideW + wallThick, H, wallThick);
    }
    // 入口中央の塞ぎ（後方ドア閉鎖時のみ active）
    entranceBlockCollider = addCollider(
      -doorGap / 2 - 0.05, 0, -wallThick,
      doorGap + 0.1, H, wallThick
    );

    // 奥壁：開口左右のみ
    if (sideW > 0.05) {
      addCollider(-halfW - wallThick, 0, L - 0.05, sideW + wallThick, H, wallThick);
      addCollider(halfW - sideW, 0, L - 0.05, sideW + wallThick, H, wallThick);
    }
    // 延長廊下の行き止まり
    addCollider(-halfW - wallThick, 0, L + extLen, W + wallThick * 2, H, wallThick);

    playBounds = {
      halfW: halfW,
      zMin: 0.35,
      zMinOpen: -0.4,
      zMaxClosed: L - 0.35,
      zMaxOpen: L + extLen - 0.4
    };
  }

  // ============================================================
  // FURNITURE
  // ============================================================
  function buildFurniture() {
    // 左壁：棚＋花瓶／右壁：長いカウンター／左壁：絵画3枚
    createShelfAndVase(-1.48, 0, 8.5);
    createTable(1.35, 0, 17.5);
    createFramedPainting(-1.68, 1.55, 26.0, 'painting_l', 0,
      '霧に沈む森が描かれている。どこかこの廊下に似ている。');
    createFramedPainting(-1.68, 1.55, 28.0, 'painting_c', 1,
      '古い建物のシルエットだ。窓だけがぼんやりと光っている。');
    createFramedPainting(-1.68, 1.55, 30.0, 'painting_r', 2,
      '曇天の風景画。額縁の角が少し傷んでいる。');
  }

  function registerInteractable(spec) {
    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(spec.hx || 0.5, spec.hy || 0.5, spec.hz || 0.5),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hit.position.copy(spec.position);
    hit.userData.interactId = spec.id;
    scene.add(hit);
    const item = {
      id: spec.id,
      kind: spec.kind || 'inspect',
      label: spec.label || '調べる',
      message: spec.message || '特に何もない。',
      position: spec.position.clone(),
      radius: spec.radius || 2.2,
      hitMesh: hit,
      inspected: false
    };
    interactables.push(item);
    return item;
  }

  function createShelfAndVase(x, y, z) {
    // 左壁に背を向けて配置（背面 = ローカル -Z → 回転後ワールド -X）
    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.y = Math.PI / 2;
    group.scale.set(1.3, 1.3, 1.3);

    const woodTex = createFurnitureWoodTexture(128, 5);
    const woodTexDark = createFurnitureWoodTexture(128, -15);
    const wood = new THREE.MeshStandardMaterial({
      map: woodTex, roughness: 0.72, metalness: 0.08, color: 0xb09a78
    });
    const darkWood = new THREE.MeshStandardMaterial({
      map: woodTexDark, roughness: 0.78, metalness: 0.06, color: 0x8a7358
    });

    const sideGeo = new THREE.BoxGeometry(0.05, 0.92, 0.36);
    const leftSide = new THREE.Mesh(sideGeo, wood);
    leftSide.position.set(-0.3, 0.46, 0);
    group.add(leftSide);
    const rightSide = new THREE.Mesh(sideGeo, wood);
    rightSide.position.set(0.3, 0.46, 0);
    group.add(rightSide);

    // 棚板 3段 + 最上段天板（i=3）
    const shelfGeo = new THREE.BoxGeometry(0.62, 0.028, 0.38);
    const topShelfY = 0.08 + 3 * 0.28; // 0.92
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Mesh(shelfGeo, darkWood);
      s.position.set(0, 0.08 + i * 0.28, 0.01);
      group.add(s);
    }

    const back = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.92, 0.025), wood);
    back.position.set(0, 0.46, -0.17);
    group.add(back);

    const trim = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.02, 0.02), darkWood);
    trim.position.set(0, 0.9, 0.17);
    group.add(trim);

    // 花瓶 — 最上段天板上（天板上面 ≈ topShelfY + 0.014）
    const topSurface = topShelfY + 0.014;
    const vaseGroup = new THREE.Group();
    vaseGroup.position.set(0, topSurface, 0.04);

    const vaseMat = new THREE.MeshStandardMaterial({
      color: 0x7a6a58, roughness: 0.35, metalness: 0.12
    });
    const vaseGlaze = new THREE.MeshStandardMaterial({
      color: 0x9a8a70, roughness: 0.28, metalness: 0.18
    });
    const vBase = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.025, 14), vaseMat);
    vBase.position.y = 0.0125;
    vaseGroup.add(vBase);
    const vBody = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.09, 0.16, 16), vaseGlaze);
    vBody.position.y = 0.1;
    vaseGroup.add(vBody);
    const vShoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.055, 0.05, 14), vaseGlaze);
    vShoulder.position.y = 0.2;
    vaseGroup.add(vShoulder);
    const vNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.038, 0.08, 12), vaseMat);
    vNeck.position.y = 0.26;
    vaseGroup.add(vNeck);
    const vLip = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.03, 0.022, 14), vaseGlaze);
    vLip.position.y = 0.31;
    vaseGroup.add(vLip);

    // 一輪の花（茎＋花びら＋中心＋小さな葉）
    const stemMat = new THREE.MeshStandardMaterial({
      color: 0x3a5a38, roughness: 0.7, metalness: 0.05
    });
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.005, 0.22, 6), stemMat);
    stem.position.y = 0.42; // 口（0.31）から上へ
    vaseGroup.add(stem);

    const leafMat = new THREE.MeshStandardMaterial({
      color: 0x4a6a40, roughness: 0.75, metalness: 0.02
    });
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.008, 0.018), leafMat);
    leaf.position.set(0.015, 0.38, 0);
    leaf.rotation.z = 0.4;
    vaseGroup.add(leaf);

    const petalMat = new THREE.MeshStandardMaterial({
      color: 0xc4a0a8, roughness: 0.55, metalness: 0.05
    });
    const centerMat = new THREE.MeshStandardMaterial({
      color: 0xd4b060, roughness: 0.45, metalness: 0.1
    });
    for (let i = 0; i < 5; i++) {
      const petal = new THREE.Mesh(
        new THREE.SphereGeometry(0.018, 6, 5),
        petalMat
      );
      const ang = (i / 5) * Math.PI * 2;
      petal.position.set(Math.cos(ang) * 0.016, 0.53, Math.sin(ang) * 0.016);
      petal.scale.set(1, 0.45, 0.7);
      vaseGroup.add(petal);
    }
    const flowerCenter = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), centerMat);
    flowerCenter.position.y = 0.53;
    vaseGroup.add(flowerCenter);

    group.add(vaseGroup);
    vaseMesh = vaseGroup;

    scene.add(group);

    // 回転後のAABB（背が壁向き）
    const depth = 0.4;
    const width = 0.7;
    addCollider(x - depth * 0.55, 0, z - width * 0.5, depth, 0.98, width);

    registerInteractable({
      id: 'shelf',
      kind: 'inspect',
      label: '調べる',
      message: '特に何もない。',
      position: new THREE.Vector3(x + 0.15, 0.45, z),
      radius: 1.8,
      hx: 0.6, hy: 1.0, hz: 0.8
    });
    registerInteractable({
      id: 'vase',
      kind: 'inspect',
      label: '調べる',
      message: '特に何もない。',
      position: new THREE.Vector3(x + 0.12, topSurface + 0.25, z),
      radius: 1.7,
      hx: 0.3, hy: 0.6, hz: 0.3
    });
  }

  function createTable(x, y, z) {
    // 右壁に沿った長い木製カウンター
    const group = new THREE.Group();
    group.position.set(x, y, z);

    const topTex = createFurnitureWoodTexture(256, 12);
    const sideTex = createFurnitureWoodTexture(128, -6);
    const topMat = new THREE.MeshStandardMaterial({
      map: topTex, roughness: 0.6, metalness: 0.08, color: 0xb8a488
    });
    const sideMat = new THREE.MeshStandardMaterial({
      map: sideTex, roughness: 0.72, metalness: 0.05, color: 0x8a7558
    });
    const darkMat = new THREE.MeshStandardMaterial({
      map: sideTex, roughness: 0.8, metalness: 0.04, color: 0x6a5840
    });

    // 天板（長い・厚みあり） depth(廊下方向) x 短い奥行き(壁方向) → 実際は z 方向に長い
    // ローカル: X=壁から廊下へ, Y=高さ, Z=廊下に沿った長さ
    const len = 2.9;
    const depth = 0.52;
    const topH = 0.06;
    const topY = 0.92;

    const top = new THREE.Mesh(new THREE.BoxGeometry(depth, topH, len), topMat);
    top.position.set(0, topY, 0);
    group.add(top);
    // 木口の面取り風
    const lip = new THREE.Mesh(new THREE.BoxGeometry(depth + 0.02, 0.02, len + 0.02), topMat);
    lip.position.set(0, topY - topH / 2 - 0.01, 0);
    group.add(lip);

    // 前面パネル（細い脚ではなく厚みのある側板）
    const front = new THREE.Mesh(new THREE.BoxGeometry(0.04, topY - 0.04, len - 0.08), sideMat);
    front.position.set(-depth / 2 + 0.02, (topY - 0.04) / 2, 0);
    group.add(front);

    // 背面（壁側）
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.04, topY - 0.02, len), darkMat);
    back.position.set(depth / 2 - 0.02, (topY - 0.02) / 2, 0);
    group.add(back);

    // 左右のエンドパネル
    const endL = new THREE.Mesh(new THREE.BoxGeometry(depth - 0.04, topY - 0.04, 0.05), sideMat);
    endL.position.set(0, (topY - 0.04) / 2, -len / 2 + 0.03);
    group.add(endL);
    const endR = new THREE.Mesh(new THREE.BoxGeometry(depth - 0.04, topY - 0.04, 0.05), sideMat);
    endR.position.set(0, (topY - 0.04) / 2, len / 2 - 0.03);
    group.add(endR);

    // 内部の仕切り（収納感）
    for (let i = -1; i <= 1; i++) {
      const div = new THREE.Mesh(new THREE.BoxGeometry(depth - 0.08, topY - 0.12, 0.03), darkMat);
      div.position.set(0, (topY - 0.12) / 2 + 0.02, i * (len / 3.2));
      group.add(div);
    }

    // 巾木風の底枠
    const kick = new THREE.Mesh(new THREE.BoxGeometry(depth - 0.02, 0.08, len - 0.04), darkMat);
    kick.position.set(0, 0.04, 0);
    group.add(kick);

    scene.add(group);

    // 衝突：カウンター本体（通路を塞がないよう壁寄り）
    addCollider(x - depth / 2 - 0.02, 0, z - len / 2, depth + 0.04, topY + 0.05, len);

    registerInteractable({
      id: 'table',
      kind: 'inspect',
      label: '調べる',
      message: '特に何もない。',
      position: new THREE.Vector3(x - 0.2, 0.7, z),
      radius: 2.0,
      hx: depth + 0.15, hy: 1.0, hz: len * 0.4
    });
  }

  function createFramedPainting(x, y, z, id, variant, message) {
    id = id || 'painting';
    variant = variant || 0;
    message = message || '特に何もない。';

    const group = new THREE.Group();
    group.position.set(x, y, z);
    group.rotation.y = Math.PI / 2;
    group.scale.set(1.25, 1.25, 1.25);

    const frameTex = createFurnitureWoodTexture(128, -20 - variant * 3);
    const frameMat = new THREE.MeshStandardMaterial({
      map: frameTex, roughness: 0.48, metalness: 0.18, color: 0x6a5848
    });
    // 厚みのある外枠
    const outer = new THREE.Mesh(new THREE.BoxGeometry(0.82, 0.64, 0.07), frameMat);
    group.add(outer);
    // 内枠（一段奥）
    const inner = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.52, 0.05), frameMat);
    inner.position.z = 0.025;
    group.add(inner);
    // 角の段差
    const bead = new THREE.Mesh(new THREE.BoxGeometry(0.64, 0.46, 0.02), frameMat);
    bead.position.z = 0.04;
    group.add(bead);

    const matte = makeMat(0x2a2520, 0.92, 0.02);
    const matteMesh = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.42, 0.012), matte);
    matteMesh.position.z = 0.048;
    group.add(matteMesh);

    const paintTex = createLandscapePaintingTexture(variant);
    const paintMat = new THREE.MeshStandardMaterial({
      map: paintTex, roughness: 0.82, metalness: 0.02
    });
    const painting = new THREE.Mesh(new THREE.PlaneGeometry(0.54, 0.4), paintMat);
    painting.position.z = 0.058;
    group.add(painting);

    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 0.12, metalness: 0.35, transparent: true, opacity: 0.07
    });
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.41), glassMat);
    glass.position.z = 0.062;
    group.add(glass);

    scene.add(group);
    if (id === 'painting_c') paintingCenterGroup = group;
    addCollider(x - 0.06, y - 0.32, z - 0.42, 0.14, 0.65, 0.84);

    registerInteractable({
      id: id,
      kind: 'inspect',
      label: '調べる',
      message: message,
      position: new THREE.Vector3(x + 0.15, y, z),
      radius: 1.9,
      hx: 0.3, hy: 0.7, hz: 0.55
    });
  }

  /** 血痕テクスチャ（不規則な染み） */
  function createBloodStainTexture(seed) {
    const s = seed || 1;
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 128, 128);
    // 不規則な染みの塊
    for (let i = 0; i < 5 + (s % 3); i++) {
      const cx = 40 + ((s * 17 + i * 31) % 50);
      const cy = 40 + ((s * 13 + i * 23) % 50);
      const r = 18 + ((s + i * 7) % 20);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, 'rgba(90, 20, 12, 0.75)');
      g.addColorStop(0.45, 'rgba(60, 14, 10, 0.5)');
      g.addColorStop(0.8, 'rgba(40, 12, 8, 0.2)');
      g.addColorStop(1, 'rgba(30, 10, 6, 0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      // 歪んだ楕円
      ctx.ellipse(cx, cy, r * (0.8 + (i % 3) * 0.15), r * (0.55 + (i % 2) * 0.2), (i * 0.7), 0, Math.PI * 2);
      ctx.fill();
    }
    // にじみの小粒
    for (let i = 0; i < 8; i++) {
      const px = 20 + ((s * 11 + i * 19) % 90);
      const py = 20 + ((s * 7 + i * 29) % 90);
      ctx.fillStyle = 'rgba(70, 18, 10, ' + (0.15 + (i % 4) * 0.08) + ')';
      ctx.beginPath();
      ctx.arc(px, py, 2 + (i % 3), 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c);
    if (THREE.SRGBColorSpace !== undefined) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /** 靴跡テクスチャ */
  function createFootprintTexture(isLeft) {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.clearRect(0, 0, 64, 128);
    // 靴底の外形
    ctx.fillStyle = 'rgba(45, 22, 14, 0.55)';
    ctx.beginPath();
    const ox = isLeft ? -2 : 2;
    ctx.moveTo(32 + ox, 8);
    ctx.bezierCurveTo(48 + ox, 12, 52 + ox, 40, 48 + ox, 70);
    ctx.bezierCurveTo(50 + ox, 100, 42 + ox, 120, 32 + ox, 122);
    ctx.bezierCurveTo(22 + ox, 120, 14 + ox, 100, 16 + ox, 70);
    ctx.bezierCurveTo(12 + ox, 40, 16 + ox, 12, 32 + ox, 8);
    ctx.fill();
    // かかと
    ctx.fillStyle = 'rgba(35, 16, 10, 0.4)';
    ctx.beginPath();
    ctx.ellipse(32 + ox, 100, 12, 16, 0, 0, Math.PI * 2);
    ctx.fill();
    // かすれ
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.arc(10 + i * 9, 20 + (i % 3) * 30, 3 + (i % 2), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    const tex = new THREE.CanvasTexture(c);
    if (THREE.SRGBColorSpace !== undefined) tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function makeDecalMat(map, opacity) {
    return new THREE.MeshStandardMaterial({
      map: map,
      transparent: true,
      opacity: opacity || 0.7,
      depthWrite: false,
      roughness: 0.95,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });
  }

  /** ストーリー段階4：日記＋金庫（異変は ensureAnomalyLevel で別管理） */
  function spawnLoop4Events() {
    if (loop4Spawned) return;
    loop4Spawned = true;
    storyStage = 4;
    ensureAnomalyLevel(3);

    // 日記をカウンター天板の廊下側に置く（調査しやすい位置）
    // カウンター中心 (1.35, 0, 17.5)、天板上面 y≈0.95、廊下側は -X
    const diaryGroup = new THREE.Group();
    diaryGroup.position.set(1.05, 0.955, 17.0);
    diaryGroup.rotation.y = 0.35;
    const cover = new THREE.Mesh(
      new THREE.BoxGeometry(0.2, 0.028, 0.26),
      new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.85, emissive: 0x1a1008, emissiveIntensity: 0.08 })
    );
    diaryGroup.add(cover);
    const pages = new THREE.Mesh(
      new THREE.BoxGeometry(0.17, 0.02, 0.23),
      new THREE.MeshStandardMaterial({ color: 0xd4c8a8, roughness: 0.88 })
    );
    pages.position.y = 0.02;
    diaryGroup.add(pages);
    const page2 = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.01, 0.21),
      new THREE.MeshStandardMaterial({ color: 0xc8bc98, roughness: 0.9 })
    );
    page2.position.set(0.03, 0.035, 0);
    page2.rotation.z = 0.12;
    diaryGroup.add(page2);
    scene.add(diaryGroup);

    registerInteractable({
      id: 'diary',
      kind: 'diary',
      label: '調べる',
      message: '',
      position: new THREE.Vector3(1.0, 1.05, 17.0),
      radius: 2.2,
      hx: 0.45, hy: 0.4, hz: 0.4
    });

    createSafeBehindPainting();
    safeState = 'painting';
  }

  /** 異変レベルに応じて汚れ・足跡を追加（累積・減らない） */
  function addAnomalySet(level) {
    if (!anomalyRoot) {
      anomalyRoot = new THREE.Group();
      scene.add(anomalyRoot);
    }
    if (level === 1) {
      // 2週目：薄い血痕のみ
      [[0.4, 14.0, 0.28, 1], [-0.35, 22.0, 0.22, 2]].forEach(function (p) {
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(p[2], p[2] * 0.85),
          makeDecalMat(createBloodStainTexture(p[3]), 0.45)
        );
        m.rotation.x = -Math.PI / 2;
        m.position.set(p[0], 0.006, p[1]);
        anomalyRoot.add(m);
      });
    } else if (level === 2) {
      // 3週目：増やす＋薄い足跡
      [[0.25, 9.5, 0.32, 3], [-0.4, 28.0, 0.3, 4], [0.15, 33.0, 0.36, 5]].forEach(function (p) {
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(p[2], p[2] * 0.9),
          makeDecalMat(createBloodStainTexture(p[3]), 0.58)
        );
        m.rotation.x = -Math.PI / 2;
        m.position.set(p[0], 0.006, p[1]);
        anomalyRoot.add(m);
      });
      const ws = new THREE.Mesh(
        new THREE.PlaneGeometry(0.32, 0.5),
        makeDecalMat(createBloodStainTexture(6), 0.42)
      );
      ws.position.set(-CONFIG.corridorWidth / 2 + 0.015, 0.9, 16);
      ws.rotation.y = Math.PI / 2;
      anomalyRoot.add(ws);
      addFootprints(4, 8.0, 3.2, 10);
    } else if (level === 3) {
      // 4週目：はっきりした異変
      [[0.5, 11.5, 0.42, 7], [-0.3, 19.0, 0.38, 8], [0.2, 31.0, 0.48, 9]].forEach(function (p) {
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(p[2], p[2] * 0.85),
          makeDecalMat(createBloodStainTexture(p[3]), 0.72)
        );
        m.rotation.x = -Math.PI / 2;
        m.position.set(p[0], 0.006, p[1]);
        anomalyRoot.add(m);
      });
      const ws2 = new THREE.Mesh(
        new THREE.PlaneGeometry(0.4, 0.65),
        makeDecalMat(createBloodStainTexture(11), 0.55)
      );
      ws2.position.set(-CONFIG.corridorWidth / 2 + 0.015, 1.15, 24);
      ws2.rotation.y = Math.PI / 2;
      anomalyRoot.add(ws2);
      addFootprints(7, 12.0, 2.6, 20);
    } else if (level >= 4) {
      [[-0.5, 15, 0.3, 12], [0.45, 26, 0.4, 13], [0.1, 36, 0.35, 14]].forEach(function (p) {
        const m = new THREE.Mesh(
          new THREE.PlaneGeometry(p[2], p[2]),
          makeDecalMat(createBloodStainTexture(p[3]), 0.7)
        );
        m.rotation.x = -Math.PI / 2;
        m.position.set(p[0], 0.006, p[1]);
        anomalyRoot.add(m);
      });
      addFootprints(5, 30, 2.4, 30);
    }
  }

  function addFootprints(count, startZ, step, seedBase) {
    const leftTex = createFootprintTexture(true);
    const rightTex = createFootprintTexture(false);
    for (let i = 0; i < count; i++) {
      const isLeft = i % 2 === 0;
      const side = isLeft ? -0.14 : 0.14;
      const jitter = ((seedBase + i * 3) % 7) * 0.02 - 0.06;
      const fp = new THREE.Mesh(
        new THREE.PlaneGeometry(0.12, 0.24),
        makeDecalMat(isLeft ? leftTex : rightTex, 0.45 + (i % 3) * 0.08)
      );
      fp.rotation.x = -Math.PI / 2;
      // 進行方向（+Z）へ
      fp.rotation.z = (isLeft ? -0.1 : 0.1) + jitter * 0.5;
      fp.position.set(side + jitter, 0.007, startZ + i * step + ((seedBase + i) % 5) * 0.08);
      if (anomalyRoot) anomalyRoot.add(fp);
    }
  }

  function showDiaryMessage() {
    // 1944 だけ黄色（HTML）
    const body =
      '気がつ⬛︎たら私はそこにいた。ここはどこなんだろう？でも進むし⬛︎ない。' +
      '何回も同じ場所を進むしかないのだ⬛︎⬛︎。ニゲロ。あの大き⬛︎⬛︎に襲⬛︎れる⬛︎。でないと⬛︎⬛︎⬛︎';
    const html =
      '<span style="color:#d4b84a;font-weight:600">1944</span>' +
      '<span style="color:#e4dccf">年○月×日</span><br><br>' +
      '<span style="color:#e4dccf">' + body + '</span>';
    messageOpen = true;
    if (messageText) {
      messageText.innerHTML = html;
    }
    messagePanel.classList.remove('hidden');
    if (actionBtn) actionBtn.classList.add('hidden');
  }

  /** ストーリー段階の更新（謎解き中の通過では進めない） */
  function updateStoryOnLoop() {
    if (puzzleStarted && !puzzleSolved) return;

    if (storyStage === 1 && loopCount >= 2) {
      storyStage = 2;
      ensureAnomalyLevel(1); // 2週目：薄い異変
    }
    if (storyStage === 2 && loopCount >= 3) {
      storyStage = 3;
      ensureAnomalyLevel(2); // 3週目：増やす
    }
    // 暗号成功後の次ループでステージ4（日記・金庫）
    if (puzzleSolved && storyStage === 3) {
      storyStage = 4;
      ensureAnomalyLevel(3);
      if (!loop4Spawned) spawnLoop4Events();
    }
    if (storyStage >= 4 && hasKey && anomalyLevel < 4) {
      storyStage = 5;
      ensureAnomalyLevel(4);
    }
  }

  function ensureAnomalyLevel(level) {
    if (!anomalyRoot) {
      anomalyRoot = new THREE.Group();
      anomalyRoot.name = 'anomalies';
      scene.add(anomalyRoot);
    }
    while (anomalyLevel < level) {
      anomalyLevel += 1;
      addAnomalySet(anomalyLevel);
    }
  }

  function createSafeBehindPainting() {
    const safeG = new THREE.Group();
    // 中央絵画位置（x=-1.68, y=1.55, z=28）の壁面
    safeG.position.set(-1.68, 1.45, 28.0);
    safeG.rotation.y = Math.PI / 2;
    safeG.visible = false;

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.48, 0.18),
      new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.55, metalness: 0.4 })
    );
    safeG.add(body);
    const dial = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.03, 16),
      new THREE.MeshStandardMaterial({ color: 0x888880, metalness: 0.7, roughness: 0.3 })
    );
    dial.rotation.x = Math.PI / 2;
    dial.position.set(0, 0.05, 0.1);
    safeG.add(dial);
    const handle = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.12, 0.04),
      new THREE.MeshStandardMaterial({ color: 0x666660, metalness: 0.6, roughness: 0.35 })
    );
    handle.position.set(0.12, -0.05, 0.1);
    safeG.add(handle);

    // 鍵（開錠後に表示）
    const keyG = new THREE.Group();
    keyG.position.set(0, -0.05, 0.12);
    keyG.visible = false;
    const keyShaft = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.02, 0.1),
      new THREE.MeshStandardMaterial({ color: 0xb8a050, metalness: 0.7, roughness: 0.35 })
    );
    keyG.add(keyShaft);
    const keyHead = new THREE.Mesh(
      new THREE.TorusGeometry(0.025, 0.008, 8, 12),
      new THREE.MeshStandardMaterial({ color: 0xb8a050, metalness: 0.7, roughness: 0.35 })
    );
    keyHead.position.z = 0.06;
    keyG.add(keyHead);
    safeG.add(keyG);
    keyObject = keyG;

    scene.add(safeG);
    safeObject = safeG;
  }

  function revealSafe() {
    if (safeState !== 'painting') return;
    safeState = 'code';
    if (paintingCenterGroup) {
      paintingCenterGroup.position.z += 0.55;
      paintingCenterGroup.position.x += 0.05;
      paintingCenterGroup.rotation.y += 0.15;
    }
    // 絵画の調査を無効化
    for (let i = 0; i < interactables.length; i++) {
      if (interactables[i].id === 'painting_c') interactables[i].radius = 0;
    }
    if (safeObject) {
      safeObject.visible = true;
      registerInteractable({
        id: 'safe',
        kind: 'safe',
        label: '調べる',
        message: '',
        position: new THREE.Vector3(-1.5, 1.45, 28.0),
        radius: 1.8,
        hx: 0.35, hy: 0.45, hz: 0.35
      });
    }
  }

  function openPinUI() {
    if (safeState === 'done' || safeState === 'key') {
      showMessage(hasKey ? '鍵はすでに手に入れた。' : '金庫は開いている。中に鍵がある。');
      return;
    }
    if (safeState !== 'code' && safeState !== 'opening') return;
    pinOpen = true;
    pinInput = '';
    const panel = document.getElementById('pin-panel');
    if (panel) {
      panel.classList.remove('hidden');
      const disp = document.getElementById('pin-display');
      if (disp) disp.textContent = '----';
    }
  }

  function closePinUI() {
    pinOpen = false;
    const panel = document.getElementById('pin-panel');
    if (panel) panel.classList.add('hidden');
  }

  function submitPin() {
    if (safeState !== 'code') return;
    if (pinInput === '1944') {
      closePinUI();
      safeState = 'opening';
      safeOpened = true;
      if (keyObject) keyObject.visible = true;
      if (safeObject) safeObject.rotation.y += 0.25;
      for (let i = 0; i < interactables.length; i++) {
        if (interactables[i].id === 'safe') interactables[i].radius = 0;
      }
      // まだ鍵は取得しない。「次へ」で取得
      safeState = 'key_msg';
      showMessageWithNext('金庫が開いた。', 'safe_key');
    } else {
      pinInput = '';
      const disp = document.getElementById('pin-display');
      if (disp) disp.textContent = '----';
      showMessage('……違う番号のようだ。');
      closePinUI();
    }
  }

  function showMessageWithNext(text, mode) {
    messageOpen = true;
    messageNextMode = mode;
    if (messageText) messageText.textContent = text;
    messagePanel.classList.remove('hidden');
    if (actionBtn) actionBtn.classList.add('hidden');
    const closeBtn = document.getElementById('message-close');
    const nextBtn = document.getElementById('message-next');
    if (closeBtn) closeBtn.classList.add('hidden');
    if (nextBtn) nextBtn.classList.remove('hidden');
  }

  function onMessageNext() {
    if (messageNextMode === 'safe_key' && !hasKey) {
      hasKey = true;
      safeState = 'done';
      messageNextMode = null;
      if (keyObject) keyObject.visible = false;
      // 通常の閉じるUIに戻して鍵入手メッセージ
      const closeBtn = document.getElementById('message-close');
      const nextBtn = document.getElementById('message-next');
      if (closeBtn) closeBtn.classList.remove('hidden');
      if (nextBtn) nextBtn.classList.add('hidden');
      if (messageText) messageText.textContent = '鍵を入手した。';
      messageOpen = true;
      messagePanel.classList.remove('hidden');
      return;
    }
    messageNextMode = null;
    closeMessage();
  }

  function setupPinUI() {
    const panel = document.getElementById('pin-panel');
    if (!panel) return;
    panel.querySelectorAll('[data-pin]').forEach(function (btn) {
      const handler = function (e) {
        e.preventDefault();
        e.stopPropagation();
        if (!pinOpen || safeOpened) return;
        const v = btn.getAttribute('data-pin');
        if (v === 'C') {
          pinInput = '';
        } else if (v === 'OK') {
          submitPin();
          return;
        } else if (pinInput.length < 4) {
          pinInput += v;
        }
        const disp = document.getElementById('pin-display');
        if (disp) disp.textContent = pinInput.padEnd(4, '-');
      };
      btn.addEventListener('click', handler);
      btn.addEventListener('touchend', handler, { passive: false });
    });
    const closeBtn = document.getElementById('pin-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function (e) {
        e.preventDefault();
        closePinUI();
      });
      closeBtn.addEventListener('touchend', function (e) {
        e.preventDefault();
        closePinUI();
      }, { passive: false });
    }
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

    // ヒンジ（左端）を中心に開くためのピボット
    const pivot = new THREE.Group();
    pivot.position.set(-doorW / 2, 0, 0);
    group.add(pivot);

    const leaf = new THREE.Group();
    leaf.position.set(doorW / 2, 0, 0);
    pivot.add(leaf);

    const door = new THREE.Mesh(new THREE.BoxGeometry(doorW, doorH, 0.06), doorWood);
    door.position.set(0, doorH / 2, 0.01);
    leaf.add(door);

    const panelMat = makeMat(0x3f3328, 0.8, 0.05);
    [[-0.22, 1.5], [0.22, 1.5], [-0.22, 0.55], [0.22, 0.55]].forEach(function (p, i) {
      const h = i < 2 ? 0.7 : 0.55;
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.38, h, 0.02), panelMat);
      panel.position.set(p[0], p[1], 0.05);
      leaf.add(panel);
    });

    const handleMat = makeMat(0x8a7a60, 0.4, 0.6);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.08), handleMat);
    handle.position.set(0.38, 1.0, 0.08);
    leaf.add(handle);

    scene.add(group);

    const col = addCollider(-0.65, 0, z - 0.15, 1.3, 2.35, 0.35);

    // ドア枠まわりの壁：枠と面一に埋め込み、隙間・段差を出さない
    {
      const wallFillMat = new THREE.MeshStandardMaterial({
        map: createWallTexture(128),
        roughness: 0.9,
        metalness: 0.02,
        color: 0xc4b8a4
      });
      const wallZ = 0.01;
      const wallD = 0.14;
      const aboveH = Math.max(0.2, CONFIG.corridorHeight - (doorH + frameThick));
      // 上部：枠の直上から天井まで、廊下全幅
      const above = new THREE.Mesh(
        new THREE.BoxGeometry(CONFIG.corridorWidth - 0.02, aboveH, wallD),
        wallFillMat
      );
      above.position.set(0, doorH + frameThick + aboveH / 2, wallZ);
      group.add(above);
      // 左右：枠外側から壁端まで、床から枠上端まで
      const fillW = (CONFIG.corridorWidth - doorW) / 2 - frameThick - 0.01;
      if (fillW > 0.04) {
        const fillH = doorH + frameThick;
        const leftFill = new THREE.Mesh(new THREE.BoxGeometry(fillW, fillH, wallD), wallFillMat);
        leftFill.position.set(-(doorW / 2 + frameThick + fillW / 2), fillH / 2, wallZ);
        group.add(leftFill);
        const rightFill = new THREE.Mesh(new THREE.BoxGeometry(fillW, fillH, wallD), wallFillMat);
        rightFill.position.set(doorW / 2 + frameThick + fillW / 2, fillH / 2, wallZ);
        group.add(rightFill);
      }
      // 枠と壁の接合を隠す薄いカバー
      const seamMat = wallFillMat.clone();
      const topSeam = new THREE.Mesh(
        new THREE.BoxGeometry(doorW + frameThick * 2 + 0.04, 0.04, wallD + 0.02),
        seamMat
      );
      topSeam.position.set(0, doorH + frameThick + 0.01, wallZ);
      group.add(topSeam);
    }

    if (id === 'front') {
      frontDoorState = {
        pivot: pivot,
        collider: col,
        open: false,
        animating: false,
        angle: 0,
        targetAngle: -Math.PI * 0.75
      };
      registerInteractable({
        id: 'door_front',
        kind: 'door',
        label: '調べる',
        message: '',
        position: new THREE.Vector3(0, 1.2, z - 0.3),
        radius: 2.1,
        hx: 1.3, hy: 2.3, hz: 0.6
      });
    } else if (id === 'back') {
      backDoorState = {
        pivot: pivot,
        collider: col,
        open: false,
        animating: false,
        angle: 0,
        // 入口側は内側から見てヒンジが逆向きに開く
        targetAngle: Math.PI * 0.75
      };
      // 初期は調査のみ「開かない」— 3周目謎解き開始後に kind を door に切替
      registerInteractable({
        id: 'door_back',
        kind: 'inspect',
        label: '調べる',
        message: '開かない',
        position: new THREE.Vector3(0, 1.2, z + 0.35),
        radius: 2.1,
        hx: 1.3, hy: 2.3, hz: 0.6
      });
    }
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
      if (settingsOpen || vaseCinematic || gameState !== 'playing') return;
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
      if (settingsOpen || vaseCinematic || gameState !== 'playing' || e.button !== 0) return;
      mouseLook.active = true;
      mouseLook.lastX = e.clientX;
      mouseLook.lastY = e.clientY;
    });
    window.addEventListener('mouseup', function () { mouseLook.active = false; });
    window.addEventListener('mousemove', function (e) {
      if (!mouseLook.active || settingsOpen || vaseCinematic || gameState !== 'playing') return;
      const dx = e.clientX - mouseLook.lastX;
      const dy = e.clientY - mouseLook.lastY;
      mouseLook.lastX = e.clientX;
      mouseLook.lastY = e.clientY;
      const m = getLookSensMult();
      applyLook(-dx * CONFIG.mouseSensitivity * m, -dy * CONFIG.mouseSensitivity * m);
    });
  }

  function onTouchStart(e) {
    if (settingsOpen || vaseCinematic || gameState !== 'playing') return;
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
    if (settingsOpen || vaseCinematic || gameState !== 'playing') return;
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
    if (vaseCinematic) return; // 花瓶演出は updateVaseCinematic がカメラを制御
    if (settingsOpen || pinOpen || gameState !== 'playing' || loopInProgress) {
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

    // ダッシュ判定
    isDashing = dashHeld && stamina > 0 && (Math.abs(inputX) + Math.abs(inputZ) > 0.05);
    if (isDashing) {
      stamina = Math.max(0, stamina - STAMINA_DRAIN * dt);
      staminaRegenTimer = 0;
    } else {
      staminaRegenTimer += dt;
      if (staminaRegenTimer >= STAMINA_REGEN_DELAY) {
        stamina = Math.min(STAMINA_MAX, stamina + STAMINA_REGEN * dt);
      }
    }
    updateStaminaUI();

    const speedMul = isDashing ? CONFIG.dashMultiplier : 1;
    const speed = CONFIG.moveSpeed * speedMul;
    const moveX = (-sin * inputZ + cos * inputX) * speed * dt;
    const moveZ = (-cos * inputZ - sin * inputX) * speed * dt;

    const prev = player.position.clone();
    const newPos = prev.clone();

    // X → Z の順に分離して解決（角でのワープ防止）
    newPos.x += moveX;
    resolveCollisionAxis(newPos, prev, 'x');
    newPos.z += moveZ;
    resolveCollisionAxis(newPos, prev, 'z');

    // 安全クランプ：廊下内に強制拘束
    const margin = CONFIG.playerRadius + 0.02;
    const halfW = playBounds.halfW;
    const frontOpen = frontDoorState && frontDoorState.open;
    const backOpen = backDoorState && backDoorState.open;
    const zMax = frontOpen ? playBounds.zMaxOpen : playBounds.zMaxClosed;
    const zMin = backOpen ? playBounds.zMinOpen : playBounds.zMin;
    newPos.x = Math.max(-halfW + margin, Math.min(halfW - margin, newPos.x));
    newPos.z = Math.max(zMin, Math.min(zMax, newPos.z));
    newPos.y = CONFIG.eyeHeight;

    // 1フレームの移動量を制限（異常ジャンプ防止）
    const maxStep = speed * dt * 1.5 + 0.02;
    if (Math.abs(newPos.x - prev.x) > maxStep) {
      newPos.x = prev.x + Math.sign(newPos.x - prev.x) * maxStep;
    }
    if (Math.abs(newPos.z - prev.z) > maxStep) {
      newPos.z = prev.z + Math.sign(newPos.z - prev.z) * maxStep;
    }

    player.position.copy(newPos);

    // 歩行／走行の頭の上下動（プレイヤー位置・衝突には影響しない）
    isMoving = len > 0.05;
    if (isMoving) {
      const bobSpeed = isDashing ? 11.5 : 7.2;
      headBobTime += dt * bobSpeed;
      const amp = isDashing ? 0.028 : 0.016;
      headBobAmount += ((amp) - headBobAmount) * Math.min(1, dt * 8);
    } else {
      headBobAmount *= Math.pow(0.02, dt); // 自然に減衰
      if (headBobAmount < 0.0005) {
        headBobAmount = 0;
        headBobTime = 0;
      }
    }
    const bobOffset = Math.sin(headBobTime) * headBobAmount;

    camera.position.set(
      player.position.x,
      player.position.y + bobOffset,
      player.position.z
    );
    camera.rotation.order = 'YXZ';
    camera.rotation.y = player.yaw;
    camera.rotation.x = player.pitch;
    camera.rotation.z = 0;

    updateHandBob(dt);
  }

  function updateHandBob(dt) {
    if (!handLightGroup) return;
    if (isMoving) {
      bobTime += dt * (isDashing ? 11 : 7.5);
    } else {
      bobTime *= 0.92;
    }
    const bobY = Math.sin(bobTime) * (isDashing ? 0.01 : 0.006);
    const bobX = Math.sin(bobTime * 0.5) * 0.003;
    handLightGroup.position.set(0.26 + bobX, -0.30 + bobY, -0.40);
  }

  /**
   * 軸分離衝突：prev の位置から見て押し出し方向を決定
   * 角に食い込んでも反対側へ飛ばさない
   */
  function resolveCollisionAxis(pos, prev, axis) {
    const r = CONFIG.playerRadius;
    const h = CONFIG.playerHeight - 0.25;
    const pMinY = pos.y - CONFIG.eyeHeight + 0.05;
    const pMaxY = pMinY + h;

    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (c.active === false) continue;

      const minX = c.min.x - r;
      const maxX = c.max.x + r;
      const minZ = c.min.z - r;
      const maxZ = c.max.z + r;

      if (pMaxY < c.min.y || pMinY > c.max.y) continue;
      if (!(pos.x > minX && pos.x < maxX && pos.z > minZ && pos.z < maxZ)) continue;

      if (axis === 'x') {
        // 移動前の X がどちら側だったかで押し出し
        const cx = (minX + maxX) * 0.5;
        if (prev.x <= cx) {
          pos.x = minX;
        } else {
          pos.x = maxX;
        }
      } else {
        const cz = (minZ + maxZ) * 0.5;
        if (prev.z <= cz) {
          pos.z = minZ;
        } else {
          pos.z = maxZ;
        }
      }
    }
  }

  // ============================================================
  // ダッシュ / 体力
  // ============================================================
  function setupDashUI() {
    const dashBtn = document.getElementById('dash-btn');
    if (!dashBtn) return;

    function setDash(on) {
      if (gameState !== 'playing' || settingsOpen || messageOpen) {
        dashHeld = false;
        dashBtn.classList.remove('active');
        return;
      }
      dashHeld = on;
      if (on) dashBtn.classList.add('active');
      else dashBtn.classList.remove('active');
    }

    dashBtn.addEventListener('touchstart', function (e) {
      e.preventDefault();
      e.stopPropagation();
      setDash(true);
    }, { passive: false });
    dashBtn.addEventListener('touchend', function (e) {
      e.preventDefault();
      e.stopPropagation();
      setDash(false);
    }, { passive: false });
    dashBtn.addEventListener('touchcancel', function (e) {
      setDash(false);
    }, { passive: false });
    dashBtn.addEventListener('mousedown', function (e) {
      e.preventDefault();
      setDash(true);
    });
    window.addEventListener('mouseup', function () { setDash(false); });

    updateStaminaUI();
  }

  function updateStaminaUI() {
    const fill = document.getElementById('stamina-fill');
    const dashBtn = document.getElementById('dash-btn');
    if (fill) fill.style.width = (stamina / STAMINA_MAX * 100) + '%';
    if (dashBtn) {
      if (stamina <= 0) dashBtn.classList.add('disabled');
      else dashBtn.classList.remove('disabled');
    }
  }

  // ============================================================
  // タイトル画面
  // ============================================================
  function setupTitleUI() {
    const btnStart = document.getElementById('btn-start');
    const btnHowto = document.getElementById('btn-howto');
    const btnSettingsTitle = document.getElementById('btn-settings-title');
    const howtoPanel = document.getElementById('howto-panel');
    const howtoBack = document.getElementById('howto-back');

    function bindTap(el, fn) {
      if (!el) return;
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        fn();
      });
      el.addEventListener('touchend', function (e) {
        e.preventDefault();
        e.stopPropagation();
        fn();
      }, { passive: false });
    }

    bindTap(btnStart, startGame);
    bindTap(btnHowto, function () {
      gameState = 'howto';
      document.getElementById('title-screen').classList.add('hidden');
      howtoPanel.classList.remove('hidden');
    });
    bindTap(btnSettingsTitle, function () {
      openSettings();
    });
    bindTap(howtoBack, function () {
      howtoPanel.classList.add('hidden');
      showTitleScreen();
    });
  }

  function showTitleScreen() {
    gameState = 'title';
    document.body.classList.add('state-title');
    document.body.classList.remove('state-playing');
    const ts = document.getElementById('title-screen');
    if (ts) ts.classList.remove('hidden');
    const howto = document.getElementById('howto-panel');
    if (howto) howto.classList.add('hidden');
    // 入力リセット
    joystick.active = false;
    joystick.dx = 0;
    joystick.dy = 0;
    lookTouch.active = false;
    if (actionBtn) actionBtn.classList.add('hidden');
  }

  function startGame() {
    const ts = document.getElementById('title-screen');
    if (ts) ts.classList.add('hidden');
    const howto = document.getElementById('howto-panel');
    if (howto) howto.classList.add('hidden');
    document.body.classList.remove('state-title');
    document.body.classList.add('state-playing');

    // 安全な初期位置
    resetPlayerToStart();
    loopCount = 1;
    loopInProgress = false;

    // 導入ストーリーへ
    beginIntro();
  }

  function resetPlayerToStart() {
    player.position.set(0, CONFIG.eyeHeight, 3.5);
    player.yaw = Math.PI;
    player.pitch = 0;
    camera.position.copy(player.position);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = player.yaw;
    camera.rotation.x = 0;
    camera.rotation.z = 0;
    joystick.active = false;
    joystick.dx = 0;
    joystick.dy = 0;
    lookTouch.active = false;
    keys.forward = keys.back = keys.left = keys.right = false;
  }

  function beginIntro() {
    gameState = 'intro';
    introIndex = 0;
    document.body.classList.add('state-intro');
    const overlay = document.getElementById('intro-overlay');
    const textEl = document.getElementById('intro-text');
    const hintEl = document.getElementById('intro-hint');
    if (!overlay || !textEl) {
      endIntro();
      return;
    }
    overlay.classList.remove('hidden');
    textEl.classList.remove('visible');
    if (hintEl) hintEl.classList.remove('visible');
    textEl.textContent = INTRO_LINES[0];
    // フェードイン
    setTimeout(function () {
      textEl.classList.add('visible');
      if (hintEl) hintEl.classList.add('visible');
    }, 80);

    // タップで進む（一度だけバインド）
    if (!overlay._introBound) {
      overlay._introBound = true;
      let lastTap = 0;
      function advance(e) {
        if (gameState !== 'intro') return;
        e.preventDefault();
        e.stopPropagation();
        const now = Date.now();
        if (now - lastTap < 350) return; // 誤連続タップ防止
        lastTap = now;
        introIndex += 1;
        if (introIndex >= INTRO_LINES.length) {
          endIntro();
          return;
        }
        textEl.classList.remove('visible');
        setTimeout(function () {
          textEl.textContent = INTRO_LINES[introIndex];
          textEl.classList.add('visible');
        }, 280);
      }
      overlay.addEventListener('click', advance);
      overlay.addEventListener('touchend', advance, { passive: false });
    }
  }

  function endIntro() {
    const overlay = document.getElementById('intro-overlay');
    if (overlay) overlay.classList.add('hidden');
    document.body.classList.remove('state-intro');
    gameState = 'playing';
  }

  /** ドア通過 → 暗転 → 開始地点へ */
  function triggerLoop(direction) {
    if (loopInProgress || gameState !== 'playing') return;
    loopInProgress = true;
    loopPassDirection = direction || 'up';

    const fade = document.getElementById('fade-overlay');
    if (fade) {
      fade.classList.remove('hidden');
      fade.classList.add('active');
    }
    gameState = 'intro'; // 移動ロック

    setTimeout(function () {
      // 謎解き中は通過方向を記録（周回は増やす）
      if (puzzleStarted && !puzzleSolved) {
        recordPuzzleStep(loopPassDirection);
      }

      loopCount += 1;
      resetPlayerToStart();
      resetAllDoorsClosed();
      doorOpen = false;

      setTimeout(function () {
        if (fade) {
          fade.classList.remove('active');
          setTimeout(function () {
            fade.classList.add('hidden');
          }, 450);
        }
        gameState = 'playing';
        loopInProgress = false;
        console.log('[同じ廊下] 周回:', loopCount, 'dir:', loopPassDirection);

        // 2周目メッセージ
        if (loopCount === 2 && storyStage <= 2) {
          queueMessages(['……あれ？', '後ろのドアが閉まってる……。']);
        }
        // ストーリー段階3：後方ドア解放＋環境ヒント＋花瓶
        // 謎解き中のドア通過では stage を上げない（異変の早期出現を防ぐ）
        if (!(puzzleStarted && !puzzleSolved)) {
          if (loopCount >= 3 && storyStage < 3) storyStage = 3;
        }
        if (storyStage >= 3 || (loopCount >= 3 && !puzzleStarted)) {
          enableBackDoorForPuzzle();
          if (!window._envHintsAdded) {
            window._envHintsAdded = true;
            addPuzzleEnvHints();
          }
        }
        // ストーリー段階の更新（異変は loopCount ではなく story に連動）
        updateStoryOnLoop();
      }, 400);
    }, 500);
  }

  function resetAllDoorsClosed() {
    function resetDoor(st, id, radius) {
      if (!st) return;
      st.open = false;
      st.animating = false;
      st.angle = 0;
      if (st.pivot) st.pivot.rotation.y = 0;
      if (st.collider) st.collider.active = true;
      for (let i = 0; i < interactables.length; i++) {
        if (interactables[i].id === id) {
          if (id === 'door_back' && !puzzleStarted) {
            interactables[i].kind = 'inspect';
            interactables[i].message = '開かない';
            interactables[i].radius = radius;
          } else if (id === 'door_back' && puzzleStarted) {
            interactables[i].kind = 'door';
            interactables[i].radius = radius;
          } else {
            interactables[i].radius = radius;
          }
        }
      }
    }
    resetDoor(frontDoorState, 'door_front', 2.1);
    resetDoor(backDoorState, 'door_back', 2.1);
    // 入口中央を再封鎖
    if (entranceBlockCollider) entranceBlockCollider.active = true;
  }

  function checkLoopTrigger() {
    if (loopInProgress || gameState !== 'playing') return;
    // 前方ドア通過（開口部を実際に超えたとき）
    if (frontDoorState && frontDoorState.open && player.position.z > CONFIG.corridorLength + 0.3) {
      triggerLoop('up');
      return;
    }
    // 後方ドア通過（開口部を実際に超えたとき）
    if (backDoorState && backDoorState.open && player.position.z < 0.05) {
      triggerLoop('down');
    }
  }

  function queueMessages(arr) {
    for (let i = 0; i < arr.length; i++) messageQueue.push(arr[i]);
    if (!messageOpen) drainMessageQueue();
  }

  function drainMessageQueue() {
    if (messageQueue.length === 0) return;
    const t = messageQueue.shift();
    showMessage(t);
  }

  function recordPuzzleStep(dir) {
    puzzleInput.push(dir);
    const idx = puzzleInput.length - 1;
    if (puzzleInput[idx] !== PUZZLE_ANSWER[idx]) {
      puzzleInput = [];
      queueMessages(['……順番が違う。紙の矢印を、もう一度確かめよう。']);
      return;
    }
    if (puzzleInput.length === PUZZLE_ANSWER.length) {
      puzzleSolved = true;
      puzzleInput = [];
      // 次のループ到達で storyStage 4（異変）へ
      if (storyStage < 3) storyStage = 3;
      queueMessages(['……何かが変わったようだ。']);
    }
  }

  function enableBackDoorForPuzzle() {
    puzzleStarted = true;
    for (let i = 0; i < interactables.length; i++) {
      if (interactables[i].id === 'door_back') {
        interactables[i].kind = 'door';
        interactables[i].message = '';
        interactables[i].radius = 1.4;
      }
    }
  }

  function tryOpenBackDoor() {
    if (!backDoorState || backDoorState.open || backDoorState.animating) return;
    if (!puzzleStarted) return;
    backDoorState.animating = true;
    if (actionBtn) actionBtn.classList.add('hidden');
  }

  function updateBackDoorAnimation(dt) {
    if (!backDoorState || !backDoorState.animating) return;
    const speed = 1.8;
    const target = backDoorState.targetAngle;
    const cur = backDoorState.angle;
    const next = cur + Math.sign(target - cur) * speed * dt;
    if ((target > 0 && next >= target) || (target < 0 && next <= target)) {
      backDoorState.angle = target;
      backDoorState.animating = false;
      backDoorState.open = true;
      doorOpen = true;
      if (backDoorState.collider) backDoorState.collider.active = false;
      // 入口中央の壁塞ぎを解除 → 通過可能に
      if (entranceBlockCollider) entranceBlockCollider.active = false;
      for (let i = 0; i < interactables.length; i++) {
        if (interactables[i].id === 'door_back') interactables[i].radius = 0;
      }
    } else {
      backDoorState.angle = next;
    }
    backDoorState.pivot.rotation.y = backDoorState.angle;
  }

  /** ストーリー段階3：花瓶落下＋カメラ演出 */
  function updateVaseEvent(dt) {
    if (storyStage < 3 && loopCount < 3) return;

    // 演出中：操作ロック・カメラ追従
    if (vaseCinematic) {
      updateVaseCinematic(dt);
      return;
    }

    if (!vaseEventTriggered && gameState === 'playing' && !loopInProgress) {
      if (player.position.z > 6.5) {
        startVaseFall();
      }
    }
    if (vaseFallState && vaseFallState.active && vaseMesh) {
      vaseFallState.vy -= 9.5 * dt;
      vaseMesh.position.y += vaseFallState.vy * dt;
      const wp = new THREE.Vector3();
      vaseMesh.getWorldPosition(wp);
      if (wp.y < 0.08) {
        const worldPos = wp.clone();
        worldPos.y = 0.06;
        scene.attach(vaseMesh);
        vaseMesh.position.copy(worldPos);
        vaseMesh.rotation.set(1.2, 0.3, 0.5);
        vaseFallState.active = false;
        vaseFallState.done = true;
        for (let i = 0; i < interactables.length; i++) {
          if (interactables[i].id === 'vase') {
            interactables[i].position.set(worldPos.x, 0.35, worldPos.z);
            interactables[i].message = '花瓶が割れている。中から紙切れが落ちたようだ。';
            if (interactables[i].hitMesh) {
              interactables[i].hitMesh.position.set(worldPos.x, 0.2, worldPos.z);
            }
          }
        }
        if (!paperSpawned) spawnPaper(worldPos);
        // 着地後は注視フェーズへ
        if (vaseCinePhase === 1) {
          vaseCinePhase = 2;
          vaseCineTimer = 1.5;
        }
      }
    }
  }

  function startVaseFall() {
    if (vaseEventTriggered || !vaseMesh) return;
    vaseEventTriggered = true;
    vaseCinematic = true;
    vaseCinePhase = 0;
    vaseCineTimer = 0;
    savedYaw = player.yaw;
    savedPitch = player.pitch;
    // 操作ロック
    joystick.active = false;
    joystick.dx = 0;
    joystick.dy = 0;
    lookTouch.active = false;
    dashHeld = false;
    // 花瓶のワールド位置を目標に
    vaseMesh.getWorldPosition(vaseLookTarget);
  }

  function updateVaseCinematic(dt) {
    // カメラ位置はプレイヤー位置を維持（暗転なし）
    camera.position.copy(player.position);
    camera.rotation.order = 'YXZ';

    if (vaseCinePhase === 0) {
      // 花瓶方向へ滑らかに向く
      const dx = vaseLookTarget.x - player.position.x;
      const dy = vaseLookTarget.y - player.position.y;
      const dz = vaseLookTarget.z - player.position.z;
      const targetYaw = Math.atan2(-dx, -dz);
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const targetPitch = Math.atan2(dy, Math.sqrt(dx * dx + dz * dz)) * 0.6;
      // 最短角度補間
      let dyaw = targetYaw - player.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      player.yaw += dyaw * Math.min(1, dt * 3.2);
      player.pitch += (targetPitch - player.pitch) * Math.min(1, dt * 3.2);
      camera.rotation.y = player.yaw;
      camera.rotation.x = player.pitch;
      camera.rotation.z = 0;
      if (Math.abs(dyaw) < 0.08 && Math.abs(targetPitch - player.pitch) < 0.08) {
        vaseCinePhase = 1;
        vaseFallState = { active: true, vy: 0.35, done: false };
      }
      return;
    }

    if (vaseCinePhase === 1) {
      // 落下中も花瓶を追う
      if (vaseMesh) {
        vaseMesh.getWorldPosition(vaseLookTarget);
        const dx = vaseLookTarget.x - player.position.x;
        const dy = vaseLookTarget.y - player.position.y;
        const dz = vaseLookTarget.z - player.position.z;
        player.yaw = Math.atan2(-dx, -dz);
        const horiz = Math.sqrt(dx * dx + dz * dz);
        player.pitch = Math.atan2(dy, horiz) * 0.55;
      }
      camera.rotation.y = player.yaw;
      camera.rotation.x = player.pitch;
      camera.rotation.z = 0;
      // 落下自体は updateVaseEvent の physics 部分が処理（cinematic 中は early return したのでここで物理）
      if (vaseFallState && vaseFallState.active && vaseMesh) {
        vaseFallState.vy -= 9.5 * dt;
        vaseMesh.position.y += vaseFallState.vy * dt;
        const wp = new THREE.Vector3();
        vaseMesh.getWorldPosition(wp);
        if (wp.y < 0.08) {
          const worldPos = wp.clone();
          worldPos.y = 0.06;
          scene.attach(vaseMesh);
          vaseMesh.position.copy(worldPos);
          vaseMesh.rotation.set(1.2, 0.3, 0.5);
          vaseFallState.active = false;
          vaseFallState.done = true;
          for (let i = 0; i < interactables.length; i++) {
            if (interactables[i].id === 'vase') {
              interactables[i].position.set(worldPos.x, 0.35, worldPos.z);
              interactables[i].message = '花瓶が割れている。中から紙切れが落ちたようだ。';
              if (interactables[i].hitMesh) {
                interactables[i].hitMesh.position.set(worldPos.x, 0.2, worldPos.z);
              }
            }
          }
          if (!paperSpawned) spawnPaper(worldPos);
          vaseCinePhase = 2;
          vaseCineTimer = 1.5;
        }
      }
      return;
    }

    if (vaseCinePhase === 2) {
      // 約1.5秒注視
      camera.rotation.y = player.yaw;
      camera.rotation.x = player.pitch;
      camera.rotation.z = 0;
      vaseCineTimer -= dt;
      if (vaseCineTimer <= 0) {
        vaseCinePhase = 3;
        vaseCineTimer = 0.6;
      }
      return;
    }

    if (vaseCinePhase === 3) {
      // 視点を元に戻す
      let dyaw = savedYaw - player.yaw;
      while (dyaw > Math.PI) dyaw -= Math.PI * 2;
      while (dyaw < -Math.PI) dyaw += Math.PI * 2;
      player.yaw += dyaw * Math.min(1, dt * 4);
      player.pitch += (savedPitch - player.pitch) * Math.min(1, dt * 4);
      camera.rotation.y = player.yaw;
      camera.rotation.x = player.pitch;
      camera.rotation.z = 0;
      vaseCineTimer -= dt;
      if (vaseCineTimer <= 0 || (Math.abs(dyaw) < 0.05 && Math.abs(savedPitch - player.pitch) < 0.05)) {
        player.yaw = savedYaw;
        player.pitch = savedPitch;
        vaseCinematic = false;
        vaseCinePhase = 0;
      }
    }
  }

  function spawnPaper(nearPos) {
    if (paperSpawned) return;
    paperSpawned = true;

    // 紙テクスチャ：矢印をはっきり描画
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 320;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#e0d4b8';
    ctx.fillRect(0, 0, 256, 320);
    ctx.strokeStyle = 'rgba(80,70,50,0.25)';
    ctx.strokeRect(8, 8, 240, 304);
    ctx.fillStyle = '#1a1510';
    ctx.font = 'bold 56px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // 横一列に間隔を空けて描く
    const arrows = ['↑', '↓', '↓', '↑'];
    const startX = 48;
    const gap = 53;
    for (let i = 0; i < 4; i++) {
      ctx.fillText(arrows[i], startX + gap * i, 160);
    }
    const paperTex = new THREE.CanvasTexture(c);
    paperTex.needsUpdate = true;
    if (THREE.SRGBColorSpace !== undefined) paperTex.colorSpace = THREE.SRGBColorSpace;

    // 棚から離し、廊下中央寄りに置く（家具と調査が競合しにくい）
    const px = Math.max(-0.4, Math.min(0.4, nearPos.x + 0.55));
    const pz = nearPos.z + 0.35;
    const paperGroup = new THREE.Group();
    paperGroup.position.set(px, 0.03, pz);
    paperGroup.rotation.x = -Math.PI / 2;
    paperGroup.rotation.z = 0.15;

    const paperMat = new THREE.MeshStandardMaterial({
      map: paperTex,
      roughness: 0.8,
      metalness: 0.0,
      side: THREE.DoubleSide,
      emissive: 0x2a2418,
      emissiveIntensity: 0.22
    });
    const paper = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.45), paperMat);
    paperGroup.add(paper);
    scene.add(paperGroup);

    // 専用 kind で家具汎用テキストと分離
    registerInteractable({
      id: 'paper',
      kind: 'paper',
      label: '調べる',
      message: '紙には、四つの矢印が書かれている。\n\n↑　↓　↓　↑',
      position: new THREE.Vector3(px, 0.25, pz),
      radius: 2.4,
      hx: 0.5, hy: 0.4, hz: 0.5
    });
  }

  /** 奥ドア／入口ドア付近の控えめな床の擦れ跡（暗号ヒント） */
  function addPuzzleEnvHints() {
    const scratchMat = new THREE.MeshStandardMaterial({
      color: 0x5a4e3e,
      roughness: 0.95,
      metalness: 0.0,
      transparent: true,
      opacity: 0.35
    });
    // 奥ドア前：やや前方を向く細い擦れ
    const frontHint = new THREE.Mesh(
      new THREE.PlaneGeometry(0.08, 0.55),
      scratchMat
    );
    frontHint.rotation.x = -Math.PI / 2;
    frontHint.position.set(0.35, 0.012, CONFIG.corridorLength - 1.8);
    scene.add(frontHint);
    // 入口側：反対向きの擦れ
    const backHint = new THREE.Mesh(
      new THREE.PlaneGeometry(0.07, 0.5),
      scratchMat.clone()
    );
    backHint.rotation.x = -Math.PI / 2;
    backHint.rotation.z = Math.PI;
    backHint.position.set(-0.3, 0.012, 2.2);
    scene.add(backHint);
  }

  // ============================================================
  // 探索・調査システム
  // ============================================================
  const actionBtn = document.getElementById('action-btn');
  const messagePanel = document.getElementById('message-panel');
  const messageText = document.getElementById('message-text');
  const messageClose = document.getElementById('message-close');

  function setupExplorationUI() {
    raycaster = new THREE.Raycaster();

    actionBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      e.preventDefault();
      onActionPressed();
    });
    actionBtn.addEventListener('touchend', function (e) {
      e.stopPropagation();
      e.preventDefault();
      onActionPressed();
    }, { passive: false });

    messageClose.addEventListener('click', function (e) {
      e.stopPropagation();
      closeMessage();
    });
    messageClose.addEventListener('touchend', function (e) {
      e.stopPropagation();
      e.preventDefault();
      closeMessage();
    }, { passive: false });

    const messageNext = document.getElementById('message-next');
    if (messageNext) {
      messageNext.addEventListener('click', function (e) {
        e.stopPropagation();
        e.preventDefault();
        onMessageNext();
      });
      messageNext.addEventListener('touchend', function (e) {
        e.stopPropagation();
        e.preventDefault();
        onMessageNext();
      }, { passive: false });
    }

    messagePanel.addEventListener('touchstart', function (e) { e.stopPropagation(); }, { passive: true });
    messagePanel.addEventListener('touchmove', function (e) { e.stopPropagation(); }, { passive: true });
  }

  function onActionPressed() {
    if (settingsOpen || messageOpen || pinOpen || !currentTarget) return;
    if (currentTarget.kind === 'door') {
      if (currentTarget.id === 'door_front') tryOpenFrontDoor();
      else if (currentTarget.id === 'door_back') tryOpenBackDoor();
      return;
    }
    if (currentTarget.kind === 'safe') {
      if (safeState === 'code') openPinUI();
      return;
    }
    if (currentTarget.kind === 'diary') {
      showDiaryMessage();
      return;
    }
    if (currentTarget.kind === 'inspect' || currentTarget.kind === 'paper') {
      doInspect(currentTarget);
    }
  }

  function doInspect(item) {
    if (messageOpen || pinOpen) return;
    // 金庫シーケンス中は他オブジェクトを調べない
    if (safeState === 'code' || safeState === 'opening' || safeState === 'key') {
      if (item.id !== 'painting_c') return;
    }
    const firstTime = !inspectedSet[item.id];
    inspectedSet[item.id] = true;
    item.inspected = true;

    if (item.id === 'paper' || item.kind === 'paper') {
      showMessage('紙には、四つの矢印が書かれている。\n\n↑　↓　↓　↑');
      return;
    }

    // ストーリー段階4以降：中央絵画 → 金庫出現
    if (item.id === 'painting_c' && storyStage >= 4 && safeState === 'painting') {
      revealSafe();
      showMessage('絵の裏に、何かがある……。');
      return;
    }
    if (item.id === 'painting_c' && safeState !== 'painting') {
      showMessage('裏に金庫が取り付けられている。');
      return;
    }

    showMessage(item.message || '特に何もない。');

    // 最初の探索段階の対象のみで完了判定（後の日記・紙などに引きずられない）
    if (firstTime && !allInspectedNarrationShown && storyStage <= 2) {
      const needed = ['vase', 'shelf', 'table', 'painting_l', 'painting_c', 'painting_r'];
      let all = true;
      for (let i = 0; i < needed.length; i++) {
        if (!inspectedSet[needed[i]]) { all = false; break; }
      }
      if (all) {
        allInspectedNarrationShown = true;
        messageQueue.push('ここには何もないようだ……');
      }
    }
  }

  function showMessage(text) {
    messageOpen = true;
    messageNextMode = null;
    if (messageText) messageText.textContent = text;
    messagePanel.classList.remove('hidden');
    if (actionBtn) actionBtn.classList.add('hidden');
    const closeBtn = document.getElementById('message-close');
    const nextBtn = document.getElementById('message-next');
    if (closeBtn) closeBtn.classList.remove('hidden');
    if (nextBtn) nextBtn.classList.add('hidden');
  }

  function closeMessage() {
    messageOpen = false;
    messageNextMode = null;
    messagePanel.classList.add('hidden');
    const closeBtn = document.getElementById('message-close');
    const nextBtn = document.getElementById('message-next');
    if (closeBtn) closeBtn.classList.remove('hidden');
    if (nextBtn) nextBtn.classList.add('hidden');
    if (messageQueue.length > 0) {
      setTimeout(function () { drainMessageQueue(); }, 80);
    }
  }

  function tryOpenFrontDoor() {
    if (!frontDoorState || frontDoorState.open || frontDoorState.animating) return;
    frontDoorState.animating = true;
    if (actionBtn) actionBtn.classList.add('hidden');
  }

  function updateDoorAnimation(dt) {
    if (!frontDoorState || !frontDoorState.animating) return;
    const speed = 1.8;
    const target = frontDoorState.targetAngle;
    const cur = frontDoorState.angle;
    const next = cur + Math.sign(target - cur) * speed * dt;
    if ((target < 0 && next <= target) || (target > 0 && next >= target)) {
      frontDoorState.angle = target;
      frontDoorState.animating = false;
      frontDoorState.open = true;
      doorOpen = true;
      if (frontDoorState.collider) frontDoorState.collider.active = false;
      for (let i = 0; i < interactables.length; i++) {
        if (interactables[i].id === 'door_front') {
          interactables[i].radius = 0;
        }
      }
    } else {
      frontDoorState.angle = next;
    }
    frontDoorState.pivot.rotation.y = frontDoorState.angle;
  }

  function updateInteraction() {
    if (settingsOpen || messageOpen || pinOpen || gameState !== 'playing') {
      currentTarget = null;
      if (actionBtn) actionBtn.classList.add('hidden');
      return;
    }
    // 金庫シーケンス中は対象を制限
    // safeState code: safe のみ / key: key のみ

    const camPos = camera.position;
    // 距離内の候補
    const candidates = [];
    for (let i = 0; i < interactables.length; i++) {
      const it = interactables[i];
      if (it.radius <= 0) continue;
      if (it.id === 'door_front' && frontDoorState && (frontDoorState.open || frontDoorState.animating)) continue;
      if (it.id === 'door_back' && backDoorState && (backDoorState.open || backDoorState.animating)) continue;
      // 金庫シーケンス中は操作対象を1つに限定
      if (safeState === 'code' && it.kind !== 'safe') continue;
      if (safeState === 'key' && it.kind !== 'key') continue;
      if (safeState === 'opening') continue;
      const dist = camPos.distanceTo(it.position);
      if (dist <= it.radius) candidates.push({ it: it, dist: dist });
    }

    if (candidates.length === 0) {
      currentTarget = null;
      actionBtn.classList.add('hidden');
      return;
    }

    // 画面中央レイキャスト + 正面度スコアで対象を決定
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const meshes = [];
    for (let i = 0; i < candidates.length; i++) {
      meshes.push(candidates[i].it.hitMesh);
    }
    const hits = raycaster.intersectObjects(meshes, false);

    let chosen = null;
    if (hits.length > 0) {
      // 紙・日記を優先（大型家具のヒットに負けない）
      let pickId = hits[0].object.userData.interactId;
      for (let h = 0; h < hits.length; h++) {
        const hid = hits[h].object.userData.interactId;
        if (hid === 'diary' || hid === 'paper') {
          pickId = hid;
          break;
        }
      }
      for (let i = 0; i < candidates.length; i++) {
        if (candidates[i].it.id === pickId) { chosen = candidates[i].it; break; }
      }
    }

    // フォールバック：正面を向いている候補のうち距離と向きの総合スコアが最良
    // 紙は床上のため、見下ろしているときは優先スコアを上げる
    if (!chosen) {
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
      let bestScore = -1;
      for (let i = 0; i < candidates.length; i++) {
        const to = candidates[i].it.position.clone().sub(camPos);
        const len = to.length();
        if (len < 0.01) continue;
        to.multiplyScalar(1 / len);
        const align = fwd.dot(to);
        if (align < 0.45) continue;
        let score = align * 2.0 - candidates[i].dist * 0.35;
        if (candidates[i].it.id === 'paper') {
          score += 1.2;
          if (fwd.y < -0.15) score += 0.8;
        }
        if (candidates[i].it.id === 'diary') {
          score += 1.5; // 日記をカウンターより優先
        }
        if (score > bestScore) {
          bestScore = score;
          chosen = candidates[i].it;
        }
      }
    }

    currentTarget = chosen;
    if (chosen) {
      actionBtn.textContent = chosen.label;
      actionBtn.classList.remove('hidden');
    } else {
      actionBtn.classList.add('hidden');
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
    updateDoorAnimation(dt);
    updateBackDoorAnimation(dt);
    updateVaseEvent(dt);
    checkLoopTrigger();
    updateInteraction();
    syncFlashlightBeam();
    renderer.render(scene, camera);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
