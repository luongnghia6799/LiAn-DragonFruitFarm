// game.js - Vườn Thanh Long 3D Online (Mô hình Trái Thanh Long 3D Thật & Camera Mượt Mà)

(() => {
  // ==========================================
  // 1. STATE & SAFE STORAGE
  // ==========================================
  function safeGetStorage(key, fallback) {
    try {
      return localStorage.getItem(key) || fallback;
    } catch (e) {
      return fallback;
    }
  }
  function safeSetStorage(key, val) {
    try {
      localStorage.setItem(key, val);
    } catch (e) {}
  }

  const state = {
    joined: false,
    playerName: safeGetStorage('vt3d_name', 'Thợ Vuốt Tập Sự'),
    shirtColor: safeGetStorage('vt3d_color', '#e84393'),
    hatType: safeGetStorage('vt3d_hat', 'nonla'),
    money: parseInt(safeGetStorage('vt3d_money', '0'), 10),
    fruitsStroked: parseInt(safeGetStorage('vt3d_fruits', '0'), 10),
    isNight: false,
    cameraMode: parseInt(safeGetStorage('vt3d_cam_mode', '1'), 10), // 0: Góc nhìn chuẩn sau lưng, 1: Góc nhìn toàn cảnh vườn (mặc định), 2: Góc nhìn gần
    inCloseup: false,
    activePillar: null,
    activeFruitSlot: null,
    fruitSpinY: 0,
    autoWalkTarget: null
  };

  const netChannel = ('BroadcastChannel' in window) ? new BroadcastChannel('vuon_thanh_long_3d_channel') : null;
  // Persistent local peer ID across reloads in the same tab so previous instance never clones itself as a ghost
  let localPeerId = null;
  try {
    localPeerId = sessionStorage.getItem('vt3d_local_peer_id');
    if (!localPeerId) {
      localPeerId = 'peer_' + Math.random().toString(36).substring(2, 9);
      sessionStorage.setItem('vt3d_local_peer_id', localPeerId);
    }
  } catch (e) {
    localPeerId = 'peer_' + Math.random().toString(36).substring(2, 9);
  }
  const remotePeers = new Map();

  // ==========================================
  // 2. THREE.JS SCENE & RENDERER
  // ==========================================
  const container = document.getElementById('world-container');
  const labelsContainer = document.getElementById('labels-container');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x6ec4e8); // Bầu trời xanh trong trẻo rực rỡ
  // Đẩy xa sương mù ra tít chân trời (115m - 320m) để toàn bộ khu vườn trong vắt, sắc nét, không bị lớp màng mờ đục phủ lên
  scene.fog = new THREE.Fog(0x6ec4e8, 115, 320);

  const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 350);
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Khử mờ toàn diện: Supersampling sắc nét trên cả màn hình máy tính 1x và di động Retina
  const clientDPR = window.devicePixelRatio || 1;
  renderer.setPixelRatio(Math.min(Math.max(clientDPR, 1.75), 2.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  // Tắt ToneMapping nén màu (ACESFilmic) để màu sắc giữ nguyên độ bão hòa tươi tắn, đậm đà, rực rỡ chuẩn hoạt hình
  renderer.toneMapping = THREE.NoToneMapping;
  container.appendChild(renderer.domElement);

  // Dynamic Camera Viewport & FOV: Khử hoàn toàn lỗi góc nhìn bẹp dí / tù túng trên màn hình dọc Mobile
  function updateCameraViewport() {
    const aspect = window.innerWidth / window.innerHeight;
    camera.aspect = aspect;
    if (aspect < 1.0) {
      // Màn hình dọc (Mobile): Mở rộng FOV dọc lên mức ~68-74 độ để duy trì góc nhìn ngang chuẩn ~56 độ
      // Giúp không gian vườn thanh long sâu rộng, thoáng đãng, thấy được trọn vẹn cảnh vật 2 bên
      const targetHFOV = 56 * Math.PI / 180;
      const vFOVRad = 2 * Math.atan(Math.tan(targetHFOV / 2) / aspect);
      camera.fov = Math.min(80, Math.max(50, Math.round(vFOVRad * 180 / Math.PI)));
    } else {
      camera.fov = 48;
    }
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  }
  updateCameraViewport();

  // Prevent right-click context menu on 3D canvas so right-drag rotates smoothly
  renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());

  // Lighting: Nắng vàng tươi tắn, độ tương phản đổ bóng đậm nét
  const hemiLight = new THREE.HemisphereLight(0xffffff, 0x1d5e18, 0.68);
  scene.add(hemiLight);

  const sunLight = new THREE.DirectionalLight(0xfff6db, 1.15);
  sunLight.position.set(45, 75, 40);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.width = 2048;  // Đổ bóng sắc nét mịn màng không răng cưa
  sunLight.shadow.mapSize.height = 2048;
  sunLight.shadow.camera.near = 15;
  sunLight.shadow.camera.far = 160;
  sunLight.shadow.bias = -0.0002;
  sunLight.shadow.normalBias = 0.02;
  const d = 60;
  sunLight.shadow.camera.left = -d;
  sunLight.shadow.camera.right = d;
  sunLight.shadow.camera.top = d;
  sunLight.shadow.camera.bottom = -d;
  scene.add(sunLight);

  // Performance / Eco Mode Toggle (Tiết kiệm GPU tối đa)
  const perfSettings = {
    isEco: false,
    dprNormal: Math.min(Math.max(clientDPR, 1.75), 2.5),
    dprEco: 1.0
  };

  function setEcoMode(eco) {
    perfSettings.isEco = eco;
    renderer.setPixelRatio(eco ? perfSettings.dprEco : perfSettings.dprNormal);
    renderer.shadowMap.enabled = !eco;
    sunLight.castShadow = !eco;

    const perfBtn = document.getElementById('toggle-perf-btn');
    const perfIcon = document.getElementById('perf-icon');
    const perfLabel = document.getElementById('perf-label');
    if (perfBtn && perfIcon && perfLabel) {
      if (eco) {
        if (window.lucide && window.lucide.createSvg) {
          perfIcon.innerHTML = window.lucide.createSvg('rocket');
        }
        perfLabel.textContent = 'Đang Bật Siêu Mượt';
        perfBtn.classList.add('active');
        showToast('Đã bật chế độ Siêu Mượt: Giảm tải GPU tối đa, FPS cao ngất ngưởng!');
      } else {
        if (window.lucide && window.lucide.createSvg) {
          perfIcon.innerHTML = window.lucide.createSvg('zap');
        }
        perfLabel.textContent = 'Tiết Kiệm GPU';
        perfBtn.classList.remove('active');
        showToast('Đã chuyển về chế độ Đồ Họa Đẹp (Có đổ bóng)');
      }
    }
  }

  const nightLights = [];
  const nightBulbMeshes = [];

  // ==========================================
  // 3. PROCEDURAL REALISTIC DRAGON FRUIT SKIN TEXTURE & 3D MODEL
  // ==========================================
  // Authentic Vietnamese Dragon Fruit Skin Texture (Sắc Đỏ Đô / Huyết Dụ Rượu Vang Chín Mọng)
  function createDragonFruitSkinTexture() {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const ctx = c.getContext('2d');

    // Deep wine red / burgundy / đỏ đô gradient (không bóng loáng, không hồng phấn)
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#58081c');
    grad.addColorStop(0.25, '#780d28');
    grad.addColorStop(0.55, '#881337');
    grad.addColorStop(0.85, '#6e0c24');
    grad.addColorStop(1, '#4c0519');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    // Subtle organic skin mottling & scale rib shading (mờ mịn tự nhiên, không bóng nhựa)
    for (let i = 0; i < 600; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const r = 4 + Math.random() * 18;
      const g = ctx.createRadialGradient(x, y, 1, x, y, r);
      const isLight = Math.random() > 0.5;
      g.addColorStop(0, isLight ? 'rgba(180, 20, 60, 0.12)' : 'rgba(50, 4, 15, 0.16)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  // Vietnamese Traditional Khan Ran (Checkered Scarf) Procedural Texture
  // Vietnamese Traditional Khan Ran (Checkered Scarf) Procedural Texture with woven gingham
  function createKhanRanTexture() {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, 128, 128);

    for (let y = 0; y < 128; y += 32) {
      for (let x = 0; x < 128; x += 32) {
        // Deep charcoal check
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(x, y, 16, 16);
        ctx.fillRect(x + 16, y + 16, 16, 16);
        // Semi-transparent overlay weave for authentic textile look
        ctx.fillStyle = 'rgba(71, 85, 105, 0.45)';
        ctx.fillRect(x + 16, y, 16, 16);
        ctx.fillRect(x, y + 16, 16, 16);
      }
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 3);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }
  const khanRanTexture = createKhanRanTexture();

  // Authentic Vietnamese Woven Bamboo Nón Lá Texture (16 vành nan tre & lá buông phơi thủ công)
  function createNonLaTexture() {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const ctx = c.getContext('2d');

    // Warm golden bamboo straw gradient
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#fef9c3'); // Sunny apex
    grad.addColorStop(0.35, '#fef08a');
    grad.addColorStop(0.7, '#fde047');
    grad.addColorStop(1, '#eab308'); // Warm rim base
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    // 16 Traditional Bamboo Ribs (16 vành nón lá truyền thống)
    for (let i = 1; i <= 16; i++) {
      const y = (i / 16.5) * 498 + 8;
      
      // Shadow under rib
      ctx.strokeStyle = 'rgba(180, 83, 9, 0.4)';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(0, y + 1);
      ctx.lineTo(512, y + 1);
      ctx.stroke();

      // Bright sunlight rib highlight
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(0, y - 1);
      ctx.lineTo(512, y - 1);
      ctx.stroke();

      // Hand-sewn thread stitch pattern (Đường khâu chỉ cước tỉ mỉ)
      ctx.strokeStyle = 'rgba(254, 240, 138, 0.95)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 10]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(512, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Radiating palm leaf fibers (Lá cọ buông đan xen dọc hình nón)
    for (let x = 0; x < 512; x += 6) {
      const alpha = 0.06 + Math.random() * 0.10;
      ctx.strokeStyle = `rgba(161, 98, 7, ${alpha})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + (Math.random() - 0.5) * 4, 0);
      ctx.lineTo(x + (Math.random() - 0.5) * 4, 512);
      ctx.stroke();
    }

    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.repeat.set(3, 1);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }
  const nonLaTexture = createNonLaTexture();

  // Texture & Realistic Material Loader
  const proceduralFruitSkin = createDragonFruitSkinTexture();
  const textureLoader = new THREE.TextureLoader();
  let realFruitTex = proceduralFruitSkin; // Start with procedural texture guaranteed not black
  try {
    textureLoader.load('dragon_fruit_real.jpg', (tex) => {
      tex.encoding = THREE.sRGBEncoding;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      realFruitTex = tex;
    }, undefined, (err) => {
      console.log('Using procedural dragonfruit skin canvas.');
    });
  } catch (e) {}

  // Helper to convert base64 to ArrayBuffer synchronously (immune to file:// CORS security)
  function base64ToArrayBuffer(base64) {
    const binaryString = window.atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
  }

  // Load Real 3D Dragon Fruit GLB Model (realistic_dragonfruit_3d_model.glb)
  let realisticGLBScene = null;
  let realDiffuseTexture = null;
  let realNormalTexture = null;
  let activeCloseupMeshes = [];

  // Core Dragon Fruit body radius profile R_body(y) for authentic GLB ear morphing
  function calcGLBBodyRadius(y) {
    const yn = (y - 0.10) / 0.52;
    const yn2 = yn * yn;
    if (yn2 >= 1) return 0.08;
    const base = 0.272 * Math.sqrt(1 - yn2);
    return Math.max(0.06, base * (1.0 + 0.08 * yn));
  }

  // 12 Authentic Ear Target Zones corresponding to the real bracts on the GLB model
  const GLB_EAR_ZONES = [
    // Tier 1 - Upper (4 ears near stem/crown)
    { id: 0, name: 'Tai ngọn 1', y: 0.28, angle: 0.0 },
    { id: 1, name: 'Tai ngọn 2', y: 0.28, angle: Math.PI * 0.5 },
    { id: 2, name: 'Tai ngọn 3', y: 0.28, angle: Math.PI },
    { id: 3, name: 'Tai ngọn 4', y: 0.28, angle: Math.PI * 1.5 },
    // Tier 2 - Mid (4 ears around the belly, staggered by 45°)
    { id: 4, name: 'Tai sườn 1', y: 0.08, angle: Math.PI * 0.25 },
    { id: 5, name: 'Tai sườn 2', y: 0.08, angle: Math.PI * 0.75 },
    { id: 6, name: 'Tai sườn 3', y: 0.08, angle: Math.PI * 1.25 },
    { id: 7, name: 'Tai sườn 4', y: 0.08, angle: Math.PI * 1.75 },
    // Tier 3 - Lower (4 ears near base)
    { id: 8,  name: 'Tai đáy 1', y: -0.14, angle: 0.0 },
    { id: 9,  name: 'Tai đáy 2', y: -0.14, angle: Math.PI * 0.5 },
    { id: 10, name: 'Tai đáy 3', y: -0.14, angle: Math.PI },
    { id: 11, name: 'Tai đáy 4', y: -0.14, angle: Math.PI * 1.5 }
  ];
  GLB_EAR_ZONES.forEach(ez => {
    const br = calcGLBBodyRadius(ez.y) + 0.06;
    ez.x = Math.cos(ez.angle) * br;
    ez.z = Math.sin(ez.angle) * br;
  });

  // Authentic Vietnamese Dragon Fruit "Đỏ Đô" Shader & Material Tuning
  // Transforms radioactive hot pink into rich deep wine red / burgundy (đỏ đô chín mọng)
  // and eliminates plastic specular shine (roughness 0.85, metalness 0.0)
  function applyDoDoFruitShader(material) {
    if (!material) return;
    material.roughness = 0.85; // Natural velvety organic peel, not plastic!
    material.metalness = 0.0;  // Zero metallic/plastic sheen
    material.side = THREE.DoubleSide;

    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `
        #include <map_fragment>
        #ifdef USE_MAP
          // Transform fluorescent hot pink into authentic deep ripe Vietnamese Đỏ Đô (Burgundy / Wine Red)
          vec3 c = diffuseColor.rgb;
          // Check if pixel belongs to the fruit body (magenta/pink has high red and high blue, low green)
          if (c.r > c.g * 1.15 && c.b > c.g * 0.60) {
            // Cut out harsh cold blue tones that make it look pink
            float excessB = max(0.0, c.b - c.g * 0.35);
            c.b -= excessB * 0.85;
            // Shift to rich deep wine red / đỏ đô chín mọng
            c.r = c.r * 0.70 + 0.05;
            c.g = c.g * 0.32;
            c.b = c.b * 0.22 + 0.02;
            diffuseColor.rgb = c;
          } else {
            // Bract ear tips: maintain fresh emerald green / lime tips
            diffuseColor.rgb = clamp(diffuseColor.rgb * vec3(0.85, 1.05, 0.75), 0.0, 1.0);
          }
        #endif
        `
      );
    };
    material.needsUpdate = true;
  }

  function setupLoadedGLB(gltf) {
    console.log('✅ Loaded authentic 3D dragonfruit GLB model successfully! Setting up ear morphing buffers...');
    const rawScene = gltf.scene;
    rawScene.updateMatrixWorld(true);

    const processedMeshes = [];

    rawScene.traverse((child) => {
      if (child.isMesh && child.geometry) {
        // Bake all parent node transformations directly into vertex buffer
        child.geometry.applyMatrix4(child.matrixWorld);
        child.position.set(0, 0, 0);
        child.rotation.set(0, 0, 0);
        child.scale.set(1, 1, 1);

        if (child.material) {
          applyDoDoFruitShader(child.material);
          if (!realDiffuseTexture && child.material.map) {
            realDiffuseTexture = child.material.map;
          }
          if (!realNormalTexture && child.material.normalMap) {
            realNormalTexture = child.material.normalMap;
          }
        }

        const posAttr = child.geometry.attributes.position;
        const nVerts = posAttr.count;
        const pos = posAttr.array;

        // Clone original authentic fully grown positions
        const origPositions = new Float32Array(pos);
        const tuckPositions = new Float32Array(nVerts * 3);
        const earIndices = new Int8Array(nVerts).fill(-1);
        const weights = new Float32Array(nVerts);

        for (let i = 0; i < nVerts; i++) {
          const i3 = i * 3;
          const x = pos[i3];
          const y = pos[i3 + 1];
          const z = pos[i3 + 2];

          const r = Math.sqrt(x * x + z * z);
          const br = calcGLBBodyRadius(y);
          const excess = r - br;

          if (excess > 0.012) {
            // Protruding ear vertex: tuck smoothly against body surface
            const w = Math.min(1.0, (excess - 0.012) / 0.07);
            weights[i] = w;
            const rTuck = r - w * (excess - 0.005);
            const scale = rTuck / (r || 1);
            tuckPositions[i3]     = x * scale;
            tuckPositions[i3 + 1] = y - w * 0.02;
            tuckPositions[i3 + 2] = z * scale;

            // Map vertex to closest ear zone
            let bestDist = 999;
            let bestEar = 0;
            for (let k = 0; k < GLB_EAR_ZONES.length; k++) {
              const ez = GLB_EAR_ZONES[k];
              const dx = x - ez.x;
              const dy = (y - ez.y) * 1.6;
              const dz = z - ez.z;
              const d = dx * dx + dy * dy + dz * dz;
              if (d < bestDist) {
                bestDist = d;
                bestEar = k;
              }
            }
            earIndices[i] = bestEar;
          } else {
            // Core fruit body vertex: stays untouched
            tuckPositions[i3]     = x;
            tuckPositions[i3 + 1] = y;
            tuckPositions[i3 + 2] = z;
          }
        }

        child.geometry.userData = {
          origPositions,
          tuckPositions,
          earIndices,
          weights
        };

        processedMeshes.push(child);
      }
    });

    const rootWrapper = new THREE.Group();
    processedMeshes.forEach(m => rootWrapper.add(m));

    // Center pivot cleanly around (0, 0, 0)
    const bbox = new THREE.Box3().setFromObject(rootWrapper);
    const center = new THREE.Vector3();
    bbox.getCenter(center);
    rootWrapper.position.x = -center.x;
    rootWrapper.position.z = -center.z;

    realisticGLBScene = rootWrapper;
    console.log('✨ Authentic GLB Dragon Fruit setup ready with', processedMeshes.length, 'meshes!');

    // If user is currently in close-up mode, refresh it with the realistic model
    if (state.inCloseup) {
      buildCloseup3DFruit();
    }
  }

  function tryLoadGLBModel() {
    if (typeof THREE.GLTFLoader === 'undefined') return;
    if (realisticGLBScene) return;
    const gltfLoader = new THREE.GLTFLoader();

    // 1. Try embedded Base64 first (100% CORS-proof for file:/// protocol)
    if (window.DRAGONFRUIT_MODEL_BASE64 && window.DRAGONFRUIT_MODEL_BASE64.length > 500) {
      try {
        console.log('📦 Decoding realistic 3D model from embedded base64 data (CORS-free)...');
        const arrayBuf = base64ToArrayBuffer(window.DRAGONFRUIT_MODEL_BASE64);
        gltfLoader.parse(arrayBuf, '', (gltf) => {
          setupLoadedGLB(gltf);
        }, (err) => {
          console.warn('gltfLoader.parse error, trying fetch fallback:', err);
          gltfLoader.load('realistic_dragonfruit_3d_model.glb', setupLoadedGLB);
        });
      } catch (err) {
        console.warn('Base64 decode failed, trying fetch fallback:', err);
        gltfLoader.load('realistic_dragonfruit_3d_model.glb', setupLoadedGLB);
      }
    } else {
      gltfLoader.load('realistic_dragonfruit_3d_model.glb', setupLoadedGLB, undefined, (err) => {
        // If deferred model_data.js loads shortly afterwards, try decoding
        if (!realisticGLBScene && window.DRAGONFRUIT_MODEL_BASE64) {
          tryLoadGLBModel();
        }
      });
    }
  }

  tryLoadGLBModel();
  window.addEventListener('load', () => {
    if (!realisticGLBScene) tryLoadGLBModel();
  });

  // Build sculpted Dragon Fruit Body with organic scale bumps (bẹ vảy nổi) & recessed bottom crown
  function createSculptedFruitBodyGeometry(radiusX = 0.46, radiusY = 0.62, segsW = 32, segsH = 24) {
    const geo = new THREE.SphereGeometry(1, segsW, segsH);
    const pos = geo.attributes.position;
    const v = new THREE.Vector3();

    // Scale pod positions (spherical coordinates where scales attach)
    const podCenters = [
      { lat: 0.55, lon: 0.0 }, { lat: 0.55, lon: 2.09 }, { lat: 0.55, lon: 4.18 },
      { lat: 0.18, lon: 0.7 }, { lat: 0.18, lon: 2.27 }, { lat: 0.18, lon: 3.84 }, { lat: 0.18, lon: 5.41 },
      { lat: -0.22, lon: 0.0 }, { lat: -0.22, lon: 1.57 }, { lat: -0.22, lon: 3.14 }, { lat: -0.22, lon: 4.71 },
      { lat: -0.58, lon: 0.78 }, { lat: -0.58, lon: 2.35 }, { lat: -0.58, lon: 3.92 }, { lat: -0.58, lon: 5.49 }
    ];

    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const lat = Math.asin(Math.max(-1, Math.min(1, v.y)));
      const lon = Math.atan2(v.x, v.z) + Math.PI;

      // Base prolate oval profile (plump in middle, slightly narrower at top stem and bottom floral cup)
      let rMult = 1.0 + 0.06 * Math.cos(lat * 2.2);

      // Add organic longitudinal ribs & pod swells
      for (const pod of podCenters) {
        const dLat = lat - pod.lat;
        let dLon = Math.abs(lon - pod.lon);
        if (dLon > Math.PI) dLon = Math.PI * 2 - dLon;
        const distSq = dLat * dLat * 3.5 + dLon * dLon * 1.4;
        if (distSq < 0.35) {
          rMult += Math.exp(-distSq * 9.0) * 0.085;
        }
      }

      // Recessed floral calyx cup at the very bottom (họng trái thanh long)
      let yOffset = 0;
      if (v.y < -0.88) {
        const cupFactor = (-0.88 - v.y) / 0.12;
        yOffset = cupFactor * 0.09;
      }

      pos.setXYZ(
        i,
        v.x * radiusX * rMult,
        v.y * radiusY + yOffset,
        v.z * radiusX * rMult
      );
    }

    geo.computeVertexNormals();
    return geo;
  }

  // Build a realistic curved, cupped leaf-like Dragon Fruit Ear (Ngoe / Tai Thanh Long)
  // Using a custom procedural BufferGeometry with authentic succulent PBR texture mapping
  function createCurvedEarMesh() {
    const segsU = 10;
    const segsV = 20;
    const stride = segsU + 1;
    const surfaceVerts = (segsU + 1) * (segsV + 1);
    const vertexCount = surfaceVerts * 2; // Outer + Inner succulent surface

    const positions = new Float32Array(vertexCount * 3);
    const colors = new Float32Array(vertexCount * 3);
    const uvs = new Float32Array(vertexCount * 2);
    const indices = [];

    // Outer (dorsal) surface
    for (let iv = 0; iv < segsV; iv++) {
      for (let iu = 0; iu < segsU; iu++) {
        const a = iv * stride + iu;
        const b = (iv + 1) * stride + iu;
        const c = (iv + 1) * stride + (iu + 1);
        const d = iv * stride + (iu + 1);
        indices.push(a, b, d);
        indices.push(b, c, d);
      }
    }

    // Inner (ventral) surface
    const offset = surfaceVerts;
    for (let iv = 0; iv < segsV; iv++) {
      for (let iu = 0; iu < segsU; iu++) {
        const a = offset + iv * stride + iu;
        const b = offset + (iv + 1) * stride + iu;
        const c = offset + (iv + 1) * stride + (iu + 1);
        const d = offset + iv * stride + (iu + 1);
        indices.push(a, d, b);
        indices.push(b, d, c);
      }
    }

    // Generate smooth natural UVs mapped to real dragon fruit texture
    for (let iv = 0; iv <= segsV; iv++) {
      const v = iv / segsV;
      for (let iu = 0; iu <= segsU; iu++) {
        const u = iu / segsU;
        const idx = iv * stride + iu;
        uvs[idx * 2] = 0.2 + u * 0.6;
        uvs[idx * 2 + 1] = 0.1 + v * 0.8;
        const innerIdx = offset + idx;
        uvs[innerIdx * 2] = 0.2 + u * 0.6;
        uvs[innerIdx * 2 + 1] = 0.1 + v * 0.8;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setIndex(indices);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));

    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      map: realDiffuseTexture || null,
      normalMap: realNormalTexture || null,
      normalScale: new THREE.Vector2(0.35, 0.35),
      roughness: 0.85,
      metalness: 0.0,
      side: THREE.DoubleSide
    });
    applyDoDoFruitShader(mat);

    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return { mesh, geo, segsU, segsV, surfaceVerts };
  }

  // Morph the 3D ear geometry & vertex colors based on stroke progress
  // At progress = 0: SHORT (35%), STUBBY, WILTED, CROOKED & YELLOWISH-GREEN
  // At progress = 1: LENGTHENS x3.2, PROUD S-CURVE ARCHING UPWARD, VIBRANT EMERALD GREEN WITH RUBY RIM!
  const colorBasePink = new THREE.Color(0x700c24); // Đỏ đô thẫm chân tai
  const colorMidPink = new THREE.Color(0x881337);  // Đỏ đô chín mọng
  const colorWiltedYellow = new THREE.Color(0xb5bf36); // Wilted non-stroked chartreuse
  const colorWiltedTip = new THREE.Color(0x8a7228);    // Wilted brownish tip
  const colorFreshGreen = new THREE.Color(0x00e676);   // Vibrant succulent emerald green
  const colorVibrantTip = new THREE.Color(0x059669);
  const colorCrimsonTip = new THREE.Color(0x9f1239);   // Deep wine red / Đỏ đô viền tai
  const tempColor = new THREE.Color();
  const tempBladeColor = new THREE.Color();

  function updateEarGeometry(earObj) {
    const { geo, segsU, segsV, surfaceVerts, progress, curlDir, baseWidth, baseLength, wobble } = earObj;
    const posAttr = geo.attributes.position;
    const colAttr = geo.attributes.color;

    // 1. DYNAMIC LENGTH:
    // At progress = 0: only 35% of length (nhỏ, ngắn, cụp xuống)
    // At progress = 1: stretches to 110% of length (vươn dài gấp hơn 3 lần, cong vút lên!)
    const length = baseLength * (0.35 + Math.pow(progress, 0.78) * 0.75);

    // 2. DYNAMIC WIDTH:
    const widthScale = 0.55 + progress * 0.45;

    // Pre-blend blade target colors according to progress
    tempBladeColor.copy(colorWiltedYellow).lerp(colorFreshGreen, Math.pow(progress, 0.7));

    let midSpineX = 0, midSpineY = 0, midSpineZ = 0;

    let idx = 0;
    for (let iv = 0; iv <= segsV; iv++) {
      const v = iv / segsV; // 0 at base on fruit skin -> 1 at tip

      // Width profile of a real dragon fruit bract
      const widthFactor = Math.sin((1 - v) * Math.PI * 0.54) * (1 - v * 0.18);
      const halfW = baseWidth * widthScale * widthFactor;

      // UNSTROKED TRAJECTORY (progress = 0):
      // Stunted, hugging skin, drooping downward at tip, twisted crookedly sideways
      const unstrokedY = length * (v * 0.28 - Math.pow(v, 1.8) * 0.65);
      const unstrokedZ = length * (Math.sin(v * Math.PI * 0.5) * 0.12);
      const unstrokedX = curlDir * length * Math.pow(v, 1.4) * 0.42;

      // STROKED TRAJECTORY (progress = 1.0):
      // The MAJESTIC SWAN HOOK / PROUD S-CURVE:
      // Base hugs skin, mid-section arcs outward boldly, tip sweeps high UPWARD!
      const strokedY = length * (v * 0.82 + Math.pow(v, 2.2) * 0.64);
      const strokedZ = length * (Math.sin(v * Math.PI * 0.72) * 0.78 - Math.pow(v, 3.0) * 0.18);
      const strokedX = wobble * v * 0.15;

      // Smooth interpolation between unstroked and stroked states
      const spineX = unstrokedX * (1 - progress) + strokedX;
      const spineY = unstrokedY * (1 - progress) + strokedY * progress + wobble * v * 0.08;
      const spineZ = unstrokedZ * (1 - progress) + strokedZ * progress;

      if (iv === Math.floor(segsV * 0.7)) {
        midSpineX = spineX;
        midSpineY = spineY;
        midSpineZ = spineZ;
      }

      // Color gradient along the ear:
      // Base: Magenta-pink matching fruit skin
      // Mid: Wilted chartreuse -> succulent emerald green
      // Tip: Wilted brown -> brilliant ruby-crimson!
      if (v < 0.20) {
        tempColor.copy(colorBasePink).lerp(colorMidPink, v / 0.20);
      } else if (v < 0.70) {
        const blend = (v - 0.20) / 0.50;
        tempColor.copy(colorMidPink).lerp(tempBladeColor, blend);
      } else {
        const blend = (v - 0.70) / 0.30;
        if (progress > 0.4) {
          tempColor.copy(tempBladeColor).lerp(colorCrimsonTip, blend * Math.min(1.0, progress * 1.25));
        } else {
          tempColor.copy(tempBladeColor).lerp(colorWiltedTip, blend * 0.9);
        }
      }

      for (let iu = 0; iu <= segsU; iu++) {
        const u = (iu / segsU) * 2 - 1; // -1 to +1
        const edgeTaper = 1 - u * u; // 1 at center spine, 0 at sharp lateral edges

        // 3D succulent thickness & cupped leaf profile
        const halfThick = 0.018 * edgeTaper * (1 - v * 0.65) * (0.6 + progress * 0.4);
        const cupDepth = edgeTaper * (0.012 + progress * 0.035) * (1 - v * 0.5);

        const vx = spineX + u * halfW;
        const vy = spineY;
        const vz = spineZ + cupDepth;

        // Front (outer) surface vertex
        posAttr.setXYZ(idx, vx, vy, vz + halfThick);
        colAttr.setXYZ(idx, tempColor.r, tempColor.g, tempColor.b);

        // Back (inner) surface vertex
        posAttr.setXYZ(idx + surfaceVerts, vx, vy, vz - halfThick);
        colAttr.setXYZ(idx + surfaceVerts, tempColor.r * 0.92, Math.min(1, tempColor.g * 1.05), tempColor.b * 0.88);

        idx++;
      }
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    geo.computeVertexNormals();

    // Dynamically update hit collider to follow the growing/arching ear
    if (earObj.collider) {
      earObj.collider.position.set(midSpineX, midSpineY, midSpineZ + 0.05);
      earObj.collider.scale.setScalar(0.7 + progress * 0.5);
    }
  }

  // ==========================================
  // 4. BUILD THE 3D DRAGON FRUIT ORCHARD & ATMOSPHERIC ENVIRONMENT
  // ==========================================
  const pillars = [];
  const rockColliders = [];
  const WORLD_LIMIT = 72;
  const sharedWorldFruitBodyGeo = createSculptedFruitBodyGeometry(0.11, 0.18, 14, 10);

  // Dynamic environment groups
  const cloudsGroup = new THREE.Group();
  scene.add(cloudsGroup);

  const firefliesGroup = new THREE.Group();
  scene.add(firefliesGroup);

  let sunMesh = null;
  let moonMesh = null;
  let skyDomeMesh = null;
  let waterCanalMesh = null;

  // 1. Procedural Realistic Textures for Binh Thuan Farm (Rực rỡ, sắc nét, tươi tắn)
  function createOrchardGrassTexture() {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const ctx = c.getContext('2d');

    // Nền cỏ tươi tắn, đậm đà, bão hòa màu rực rỡ phong cách anime/Ghibli
    const grad = ctx.createLinearGradient(0, 0, 512, 512);
    grad.addColorStop(0.0, '#2ea136');
    grad.addColorStop(0.3, '#3cb846');
    grad.addColorStop(0.7, '#268f2e');
    grad.addColorStop(1.0, '#32ac3b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    // Lớp đốm nắng nhẹ và bóng cỏ tương phản sắc nét
    for (let i = 0; i < 400; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const r = 10 + Math.random() * 24;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      if (Math.random() > 0.5) {
        g.addColorStop(0, 'rgba(110, 225, 85, 0.28)');
        g.addColorStop(1, 'rgba(110, 225, 85, 0)');
      } else {
        g.addColorStop(0, 'rgba(20, 75, 22, 0.30)');
        g.addColorStop(1, 'rgba(20, 75, 22, 0)');
      }
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Các tép cỏ sắc nét, rõ ràng từng ngọn
    ctx.lineWidth = 1.3;
    for (let i = 0; i < 1100; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const len = 3.5 + Math.random() * 6;
      ctx.strokeStyle = Math.random() > 0.4 ? 'rgba(145, 245, 110, 0.45)' : 'rgba(25, 78, 25, 0.42)';
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (Math.random() - 0.5) * 3, y - len);
      ctx.stroke();
    }

    // Hoa cúc trắng và nhụy vàng tươi tắn
    for (let i = 0; i < 70; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      ctx.fillStyle = Math.random() > 0.4 ? '#ffffff' : '#fde047';
      ctx.beginPath();
      ctx.arc(x, y, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }

    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(16, 16);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  function createBinhThuanDirtTexture() {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const ctx = c.getContext('2d');

    // Đất đỏ bazan Bình Thuận đậm đà, màu sắc son tươi, tương phản nổi bật với cỏ xanh
    const grad = ctx.createLinearGradient(0, 0, 512, 0);
    grad.addColorStop(0.0, '#b8461b');
    grad.addColorStop(0.2, '#d45624');
    grad.addColorStop(0.5, '#e06530');
    grad.addColorStop(0.8, '#d45624');
    grad.addColorStop(1.0, '#b04117');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    // Vệt bánh xe / lằn đường đất tự nhiên chạy dọc theo con đường
    const trackGrad1 = ctx.createLinearGradient(120, 0, 170, 0);
    trackGrad1.addColorStop(0, 'rgba(110, 36, 12, 0)');
    trackGrad1.addColorStop(0.5, 'rgba(95, 28, 10, 0.22)');
    trackGrad1.addColorStop(1, 'rgba(110, 36, 12, 0)');
    ctx.fillStyle = trackGrad1;
    ctx.fillRect(115, 0, 60, 512);

    const trackGrad2 = ctx.createLinearGradient(340, 0, 395, 0);
    trackGrad2.addColorStop(0, 'rgba(110, 36, 12, 0)');
    trackGrad2.addColorStop(0.5, 'rgba(95, 28, 10, 0.22)');
    trackGrad2.addColorStop(1, 'rgba(110, 36, 12, 0)');
    ctx.fillStyle = trackGrad2;
    ctx.fillRect(335, 0, 60, 512);

    // Các hạt cát mịn, sỏi son đỏ li ti rõ nét
    for (let i = 0; i < 750; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const r = 1 + Math.random() * 2.2;
      ctx.fillStyle = Math.random() > 0.5 ? 'rgba(255, 195, 160, 0.35)' : 'rgba(85, 25, 8, 0.32)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 16);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  function createWaterCanalTexture() {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const ctx = c.getContext('2d');

    const grad = ctx.createLinearGradient(0, 0, 256, 256);
    grad.addColorStop(0, '#105260');
    grad.addColorStop(0.5, '#197184');
    grad.addColorStop(1, '#0e4552');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);

    for (let i = 0; i < 200; i++) {
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      const r = 6 + Math.random() * 18;
      ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(2, 16);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  const orchardGrassTex = createOrchardGrassTexture();
  const binhThuanDirtTex = createBinhThuanDirtTexture();
  const waterCanalTex = createWaterCanalTexture();

  function createSkyDomeTexture() {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const ctx = c.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#1e88e5');    // Zenith vivid sky blue
    grad.addColorStop(0.45, '#64b5f6'); // Mid sky soft cerulean
    grad.addColorStop(0.72, '#bae6fd'); // Lower atmosphere pale azure
    grad.addColorStop(0.88, '#fef3c7'); // Warm morning sunlight glow near horizon
    grad.addColorStop(1.0, '#fed7aa');  // Golden horizon haze
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  function createNightSkyTexture() {
    const c = document.createElement('canvas');
    c.width = 512;
    c.height = 512;
    const ctx = c.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#050b18');    // Zenith deep galaxy
    grad.addColorStop(0.5, '#0b1633');  // Mid sky navy
    grad.addColorStop(0.8, '#151e4a');  // Lower indigo
    grad.addColorStop(1.0, '#1e1b4b');  // Horizon dusk violet
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 512, 512);

    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < 220; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 380;
      const r = Math.random() * 1.3 + 0.3;
      const alpha = 0.35 + Math.random() * 0.65;
      ctx.globalAlpha = alpha;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1.0;

    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  const skyDayTex = createSkyDomeTexture();
  const skyNightTex = createNightSkyTexture();

  // ==========================================
  // 3. CONTINUOUS 3D TERRAIN ELEVATION MODEL (Địa hình nhấp nhô hữu cơ tự nhiên)
  // ==========================================
  function getTerrainBaseHeight(x, z) {
    // Broad organic agricultural rolling slopes & knolls across the entire valley basin
    return Math.sin(x * 0.052) * 1.25 
         + Math.cos(z * 0.046) * 1.45 
         + Math.sin(x * 0.028 + z * 0.038) * 0.95 
         + Math.cos(x * 0.088 - z * 0.068) * 0.40;
  }

  function getRiverWaterHeight(z) {
    const rx = -54 + Math.sin(z * 0.05) * 5.2;
    return getTerrainBaseHeight(rx, z) - 0.42;
  }

  // 12 rows x 10 cols = 120 dragon fruit pillars
  const orchardRows = [-42, -35, -28, -21, -14, -7, 7, 14, 21, 28, 35, 42];
  const orchardCols = [-42, -34, -26, -18, -10, 10, 18, 26, 34, 42];

  function getMoundElevation(x, z) {
    if (Math.abs(z) > 45 || Math.abs(x) > 45 || Math.abs(x) < 7 || Math.abs(z) < 4) return 0;
    const rIdx = z < 0 ? Math.round((z + 42) / 7) : (6 + Math.round((z - 7) / 7));
    if (rIdx < 0 || rIdx >= 12) return 0;
    const pz = orchardRows[rIdx];
    if (Math.abs(z - pz) > 2.8) return 0;

    const isRight = x > 0;
    const absX = Math.abs(x);
    const cOffset = Math.round((absX - 10) / 8);
    if (cOffset < 0 || cOffset > 4) return 0;
    const px = isRight ? (10 + cOffset * 8) : -(10 + cOffset * 8);

    const d = Math.hypot(x - px, z - pz);
    if (d < 2.8) {
      return (1 + Math.cos((d / 2.8) * Math.PI)) * 0.5 * 0.45;
    }
    return 0;
  }

  function getTerrainHeight(x, z) {
    const dist = Math.hypot(x, z);
    let y = getTerrainBaseHeight(x, z);

    // 1. Raised earthen straw mounds under all 120 dragon fruit pillars
    y += getMoundElevation(x, z);

    // 2. Meandering river depression (dòng suối uốn lượn tự nhiên)
    const riverX = -54 + Math.sin(z * 0.05) * 5.2;
    const riverDist = Math.abs(x - riverX);
    if (riverDist < 7.5) {
      const riverDip = (1 + Math.cos((riverDist / 7.5) * Math.PI)) * 0.5;
      y -= riverDip * 1.35;
    }

    // 3. Outer perimeter rolling foothills and ridge slopes (r > 46m)
    if (dist > 46) {
      const factor = Math.min(1.0, (dist - 46) / 75);
      const outerHills = (Math.sin(x * 0.035) * 0.32 + Math.cos(z * 0.035) * 0.32 + 0.85) * 14.5;
      y += outerHills * factor * factor;
    }

    return y;
  }

  function getWalkSurfaceHeight(x, z) {
    // Check if position is on the arched wooden footbridge crossing the river at x ~ -54, z ~ 0
    const dx = x - (-54.0);
    if (Math.abs(z) <= 1.42 && Math.abs(dx) <= 3.75) {
      const archRadius = 5.2;
      const clampedDx = Math.max(-2.95, Math.min(2.95, dx));
      const by = Math.sqrt(archRadius * archRadius - clampedDx * clampedDx) - archRadius * Math.cos(0.6) + 0.15;
      const bridgeWaterY = getRiverWaterHeight(0);
      const bridgeDeckY = bridgeWaterY + 0.1 + by + 0.12;

      // Smoothly blend onto riverbank path at bridge ends
      if (Math.abs(dx) > 2.85) {
        const blend = (Math.abs(dx) - 2.85) / (3.75 - 2.85);
        const groundAtEnds = getTerrainHeight(x, z);
        return THREE.MathUtils.lerp(bridgeDeckY, groundAtEnds, Math.min(1.0, blend));
      }
      return bridgeDeckY;
    }

    let h = getTerrainHeight(x, z);

    // If near any dragon fruit pillar mound, elevate walk height so feet rest on top of mound, never sunken!
    for (let i = 0; i < pillars.length; i++) {
      const p = pillars[i];
      const pd = Math.hypot(x - p.x, z - p.z);
      if (pd < 2.3) {
        const moundCapY = p.y + 0.27;
        if (moundCapY > h) {
          const t = Math.max(0, 1 - (pd / 2.3) * (pd / 2.3));
          h = THREE.MathUtils.lerp(h, moundCapY, t);
        }
      }
    }

    return h;
  }

  function buildScenicTerrain() {
    // 1. Vast Lush Basin Terrain with Natural Undulating Slopes & Rolling Perimeter Hills
    const terrainGeo = new THREE.PlaneGeometry(340, 340, 96, 96);
    terrainGeo.rotateX(-Math.PI / 2);

    const pos = terrainGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, getTerrainHeight(x, z));
    }
    terrainGeo.computeVertexNormals();

    const groundMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: orchardGrassTex,
      roughness: 0.88,
      metalness: 0.04
    });
    const ground = new THREE.Mesh(terrainGeo, groundMat);
    ground.receiveShadow = true;
    scene.add(ground);
  }

  function buildOrchardPaths() {
    const pathsGroup = new THREE.Group();
    const dirtMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      map: binhThuanDirtTex,
      roughness: 0.92,
      metalness: 0.02
    });

    // Central Main Red-Basalt Dirt Avenue hugging the undulating terrain
    const mainRoadGeo = new THREE.PlaneGeometry(7.5, 120, 8, 48);
    mainRoadGeo.rotateX(-Math.PI / 2);
    const mPos = mainRoadGeo.attributes.position;
    for (let i = 0; i < mPos.count; i++) {
      const vx = mPos.getX(i);
      const vz = mPos.getZ(i) + 6;
      mPos.setZ(i, vz);
      mPos.setY(i, getTerrainHeight(vx, vz) + 0.02);
    }
    mainRoadGeo.computeVertexNormals();
    const mainRoad = new THREE.Mesh(mainRoadGeo, dirtMat);
    mainRoad.receiveShadow = true;
    pathsGroup.add(mainRoad);

    // Cross Paths connecting rows of dragon fruit pillars hugging terrain
    const crossRows = [-35, -21, -7, 0, 7, 21, 35];
    crossRows.forEach(rz => {
      const roadW = rz === 0 ? 5.5 : 3.2; // Grand cross promenade at z = 0 connecting to arched bridge
      const crossGeo = new THREE.PlaneGeometry(100, roadW, 40, 4);
      crossGeo.rotateX(-Math.PI / 2);
      const cPos = crossGeo.attributes.position;
      for (let i = 0; i < cPos.count; i++) {
        const vx = cPos.getX(i);
        const vz = cPos.getZ(i) + rz;
        cPos.setZ(i, vz);
        cPos.setY(i, getTerrainHeight(vx, vz) + 0.018);
      }
      crossGeo.computeVertexNormals();
      const crossRoad = new THREE.Mesh(crossGeo, dirtMat);
      crossRoad.receiveShadow = true;
      pathsGroup.add(crossRoad);
    });

    // Organic Garden Stepping Stones (Đá phiến lát đường vườn tự nhiên mềm mại)
    const stoneMats = [
      new THREE.MeshStandardMaterial({ color: 0xa8a29e, roughness: 0.82 }),
      new THREE.MeshStandardMaterial({ color: 0x78716c, roughness: 0.85 }),
      new THREE.MeshStandardMaterial({ color: 0x57534e, roughness: 0.88 })
    ];

    for (let z = -50; z <= 60; z += 3.8) {
      // 14 cạnh bo tròn tự nhiên như đá cuội/đá phiến sông, không còn đa giác nhọn hoắt
      const stoneGeo = new THREE.CylinderGeometry(0.48 + Math.random() * 0.16, 0.55 + Math.random() * 0.16, 0.045, 14);
      const stoneMesh = new THREE.Mesh(stoneGeo, stoneMats[Math.floor(Math.random() * stoneMats.length)]);
      const offsetX = (Math.random() - 0.5) * 1.6;
      const stoneZ = z + (Math.random() - 0.5) * 0.6;
      stoneMesh.position.set(offsetX, getTerrainHeight(offsetX, stoneZ) + 0.028, stoneZ);
      stoneMesh.rotation.y = Math.random() * Math.PI;
      stoneMesh.scale.set(1.0, 1.0, 0.85 + Math.random() * 0.3); // Hơi dẹt tự nhiên
      stoneMesh.receiveShadow = true;
      pathsGroup.add(stoneMesh);
    }

    scene.add(pathsGroup);
  }

  // ==========================================
  // 3D LUSH VOLUMETRIC GRASS FIELD (Cánh đồng cỏ 3D đung đưa phong cách Ghibli)
  // ==========================================
  function createGrassTexture() {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 256;
    const ctx = c.getContext('2d');

    const blades = [
      { x: 64, y: 256, cpX: 62, cpY: 120, tipX: 60, tipY: 20, w: 14, color: '#388e3c' },
      { x: 50, y: 256, cpX: 38, cpY: 140, tipX: 25, tipY: 55, w: 12, color: '#2e7d32' },
      { x: 78, y: 256, cpX: 92, cpY: 130, tipX: 104, tipY: 50, w: 12, color: '#43a047' },
      { x: 42, y: 256, cpX: 28, cpY: 170, tipX: 12, tipY: 110, w: 10, color: '#1b5e20' },
      { x: 86, y: 256, cpX: 102, cpY: 165, tipX: 118, tipY: 105, w: 10, color: '#4caf50' },
      { x: 60, y: 256, cpX: 68, cpY: 90, tipX: 72, tipY: 12, w: 11, color: '#66bb6a' }
    ];

    blades.forEach(b => {
      const grad = ctx.createLinearGradient(b.x, b.y, b.tipX, b.tipY);
      grad.addColorStop(0, '#1a472a');
      grad.addColorStop(0.35, b.color);
      grad.addColorStop(0.85, '#84cc16');
      grad.addColorStop(1.0, '#bef264');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(b.x - b.w / 2, b.y);
      ctx.quadraticCurveTo(b.cpX - b.w / 4, b.cpY, b.tipX, b.tipY);
      ctx.quadraticCurveTo(b.cpX + b.w / 4, b.cpY, b.x + b.w / 2, b.y);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = 'rgba(217, 249, 157, 0.45)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.quadraticCurveTo(b.cpX, b.cpY, b.tipX, b.tipY);
      ctx.stroke();
    });

    const tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  const grassTuftTex = createGrassTexture();

  function createGrassClumpGeometry() {
    const width = 0.75;
    const height = 0.65;
    const halfW = width / 2;
    const positions = [];
    const uvs = [];
    const indices = [];

    const angles = [0, Math.PI / 3, (Math.PI * 2) / 3];
    angles.forEach((ang, pIdx) => {
      const cos = Math.cos(ang);
      const sin = Math.sin(ang);
      const vOffset = pIdx * 4;

      positions.push(-halfW * cos, 0, -halfW * sin);
      uvs.push(0, 0);

      positions.push(halfW * cos, 0, halfW * sin);
      uvs.push(1, 0);

      positions.push(halfW * cos, height, halfW * sin);
      uvs.push(1, 1);

      positions.push(-halfW * cos, height, -halfW * sin);
      uvs.push(0, 1);

      indices.push(vOffset, vOffset + 1, vOffset + 2);
      indices.push(vOffset, vOffset + 2, vOffset + 3);
    });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return geo;
  }

  function buildScenicGrassField() {
    const grassCount = 1600;
    const tuftGeo = createGrassClumpGeometry();
    const tuftMat = new THREE.MeshLambertMaterial({
      map: grassTuftTex,
      transparent: true,
      alphaTest: 0.45,
      side: THREE.DoubleSide
    });

    const grassMesh = new THREE.InstancedMesh(tuftGeo, tuftMat, grassCount);
    const dummy = new THREE.Object3D();

    let placed = 0;
    let attempts = 0;
    while (placed < grassCount && attempts < grassCount * 3) {
      attempts++;
      const gx = (Math.random() - 0.5) * 128;
      const gz = (Math.random() - 0.5) * 128;

      // Don't place grass in the middle of the main red dirt avenue
      if (Math.abs(gx) < 3.2 && gz > -50 && gz < 55) continue;
      // Don't place inside river water channel
      const riverCenter = -54 + Math.sin(gz * 0.05) * 5.2;
      if (Math.abs(gx - riverCenter) < 3.2) continue;

      const gy = getTerrainHeight(gx, gz);
      dummy.position.set(gx, gy, gz);
      dummy.rotation.y = Math.random() * Math.PI * 2;
      dummy.rotation.x = (Math.random() - 0.5) * 0.08;
      dummy.rotation.z = (Math.random() - 0.5) * 0.08;
      const s = 1.15 + Math.random() * 0.45;
      dummy.scale.set(s, s * (0.9 + Math.random() * 0.35), s);
      dummy.updateMatrix();

      grassMesh.setMatrixAt(placed, dummy.matrix);
      placed++;
    }

    grassMesh.instanceMatrix.needsUpdate = true;
    grassMesh.receiveShadow = false; // Zero shadow map lookups for 60+ FPS
    scene.add(grassMesh);
  }

  function buildOrchardEnvironment() {
    // 1. Vast Scenic Basin Terrain with Perimeter Rolling Hills
    buildScenicTerrain();

    // 2. Central Red-Basalt Dirt Paths with Cobblestones
    buildOrchardPaths();

    // 3. Traditional Vietnamese Grand Entrance Gate at z = 58
    buildEntranceGate(0, getTerrainHeight(0, 58), 58);

    // 4. Build 120 Authentic Dragon Fruit Pillars (12 rows x 10 columns)
    const rows = orchardRows;
    const cols = orchardCols;

    let pillarId = 1;
    rows.forEach((z, rIdx) => {
      cols.forEach((x, cIdx) => {
        const pillar = createDragonFruitPillar(pillarId++, x, z, rIdx, cIdx);
        pillars.push(pillar);
      });
    });

    // 5. Overhead Electric Cable Grid & Night Light Bulbs (Hệ thống chong đèn đêm)
    buildOrchardNightLampNetwork(rows, cols);

    // 6. Sculpted 3-Tier Distant Mountain Ranges
    buildDistantMountains();

    // 7. Coconut Palms & Windbreak Flora
    buildOrchardFlora();

    // 8. 3,200 Lush 3D Volumetric Grass Tufts (Cánh đồng cỏ 3D đung đưa tự nhiên)
    buildScenicGrassField();

    // 9. 110+ 3D Wildflower Clumps, Mossy Boulders & Tropical Shade Trees
    buildScatterFlora();

    // 10. Farmer's Thatch-Roof Gazebo & Rest Hut with Bougainvillea
    buildFarmerGazebo(-18, 52);

    // 11. Meandering S-Curve River, Riverbank Stones & Arched Footbridge
    buildScenicStreamAndBridge();

    // 12. Immersive Gradient Celestial Sky Dome, Drifting Clouds, Sun & Moon
    buildSkyAndAtmosphere();

    // 13. Farm Perimeter Fences & Crates
    buildPerimeterDecorations();
  }

  // High-Resolution Gilded Calligraphy Signboard Texture: VƯỜN THANH LONG LÍ AN
  function createGateSignboardTexture() {
    const canvas = document.createElement('canvas');
    canvas.width = 2048;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');

    // Deep lacquer mahogany red gradient background
    const bgGrad = ctx.createLinearGradient(0, 0, 0, 256);
    bgGrad.addColorStop(0, '#580812');
    bgGrad.addColorStop(0.35, '#7d1421');
    bgGrad.addColorStop(0.7, '#6b0f1a');
    bgGrad.addColorStop(1, '#3a0408');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 2048, 256);

    // Subtle horizontal wood grain lines
    ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
    for (let y = 0; y < 256; y += 4) {
      ctx.fillRect(0, y, 2048, 1.5);
    }

    // Outer thick gold filigree frame
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = 14;
    ctx.strokeRect(16, 16, 2048 - 32, 256 - 32);

    // Inner gold decorative line
    ctx.strokeStyle = '#ffae00';
    ctx.lineWidth = 5;
    ctx.strokeRect(32, 32, 2048 - 64, 256 - 64);

    // Four ornate corner squares
    ctx.fillStyle = '#facc15';
    const cSize = 22;
    [[32, 32], [2048 - 32 - cSize, 32], [32, 256 - 32 - cSize], [2048 - 32 - cSize, 256 - 32 - cSize]].forEach(([cx, cy]) => {
      ctx.fillRect(cx, cy, cSize, cSize);
    });

    // Top subtitle
    ctx.font = 'bold 30px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#fef08a';
    ctx.textAlign = 'center';
    ctx.letterSpacing = '10px';
    ctx.fillText('TRANG TRẠI NÔNG NGHIỆP SINH THÁI LONG AN', 1024, 72);

    // Main Gilded Title: VƯỜN THANH LONG LÍ AN
    const mainText = 'VƯỜN THANH LONG LÍ AN';
    ctx.font = '900 96px "Space Grotesk", sans-serif';
    ctx.letterSpacing = '12px';

    // 3D carved depth shadow
    ctx.fillStyle = '#180204';
    ctx.fillText(mainText, 1028, 172);

    ctx.fillStyle = '#92400e';
    ctx.fillText(mainText, 1026, 170);

    // Radiant gold face
    const textGrad = ctx.createLinearGradient(0, 80, 0, 180);
    textGrad.addColorStop(0, '#ffffff');
    textGrad.addColorStop(0.25, '#fef08a');
    textGrad.addColorStop(0.65, '#facc15');
    textGrad.addColorStop(1, '#eab308');
    ctx.fillStyle = textGrad;
    ctx.fillText(mainText, 1024, 168);

    // Bottom subtitle VietGAP badge
    ctx.font = 'bold 26px "Space Grotesk", sans-serif';
    ctx.fillStyle = '#4ade80';
    ctx.letterSpacing = '8px';
    ctx.fillText('★ TIÊU CHUẨN XUẤT KHẨU VIETGAP QUỐC TẾ ★', 1024, 222);

    const tex = new THREE.CanvasTexture(canvas);
    tex.encoding = THREE.sRGBEncoding;
    return tex;
  }

  // Traditional Vietnamese Grand Gate with curved red tiled roof, gold calligraphy & red silk lanterns
  function buildEntranceGate(x, y, z) {
    const gateGroup = new THREE.Group();
    gateGroup.position.set(x, y, z);

    const postMat = new THREE.MeshLambertMaterial({ color: 0x991b1b }); // Deep vermilion red
    const goldMat = new THREE.MeshLambertMaterial({ color: 0xffbe0b });
    const tileMat = new THREE.MeshLambertMaterial({ color: 0xb91c1c });

    // Main Columns
    const leftPost = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.54, 7.8, 12), postMat);
    leftPost.position.set(-5.6, 3.9, 0);
    leftPost.castShadow = true;
    gateGroup.add(leftPost);

    const rightPost = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.54, 7.8, 12), postMat);
    rightPost.position.set(5.6, 3.9, 0);
    rightPost.castShadow = true;
    gateGroup.add(rightPost);

    // Stone Column Pedestals
    const stoneMat = new THREE.MeshLambertMaterial({ color: 0xd1d5db });
    const leftBase = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 1.4), stoneMat);
    leftBase.position.set(-5.6, 0.4, 0);
    gateGroup.add(leftBase);

    const rightBase = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.8, 1.4), stoneMat);
    rightBase.position.set(5.6, 0.4, 0);
    gateGroup.add(rightBase);

    // Main Crossbeam
    const beam = new THREE.Mesh(new THREE.BoxGeometry(13.4, 1.4, 0.9), postMat);
    beam.position.set(0, 7.2, 0);
    beam.castShadow = true;
    gateGroup.add(beam);

    // Traditional Curved Tiled Roof
    const roofCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-7.5, 7.8, 0),
      new THREE.Vector3(0, 8.4, 0),
      new THREE.Vector3(7.5, 7.8, 0)
    ]);
    const roofGeo = new THREE.BoxGeometry(14.8, 0.45, 2.6);
    const roof = new THREE.Mesh(roofGeo, tileMat);
    roof.position.set(0, 8.1, 0);
    roof.castShadow = true;
    gateGroup.add(roof);

    // Upturned roof eaves
    [-7.2, 7.2].forEach(ex => {
      const eave = new THREE.Mesh(new THREE.ConeGeometry(0.6, 1.2, 4), goldMat);
      eave.position.set(ex, 8.5, 0);
      eave.rotation.z = ex > 0 ? -0.5 : 0.5;
      gateGroup.add(eave);
    });

    // Gold Calligraphy Signboard: VƯỜN THANH LONG LÍ AN (Front and Back Faces)
    const signTex = createGateSignboardTexture();
    const signMat = new THREE.MeshBasicMaterial({ map: signTex });

    // Front Signboard facing South towards entrance road (+Z)
    const signBoardFront = new THREE.Mesh(new THREE.BoxGeometry(9.6, 1.2, 0.16), new THREE.MeshLambertMaterial({ color: 0x4a040b }));
    signBoardFront.position.set(0, 7.2, 0.49);
    gateGroup.add(signBoardFront);

    const signTrimFront = new THREE.Mesh(new THREE.BoxGeometry(9.88, 1.35, 0.08), goldMat);
    signTrimFront.position.set(0, 7.2, 0.47);
    gateGroup.add(signTrimFront);

    const frontSignPanel = new THREE.Mesh(new THREE.PlaneGeometry(9.5, 1.15), signMat);
    frontSignPanel.position.set(0, 7.2, 0.58);
    gateGroup.add(frontSignPanel);

    // Back Signboard facing North into the orchard (-Z)
    const signBoardBack = signBoardFront.clone();
    signBoardBack.position.set(0, 7.2, -0.49);
    gateGroup.add(signBoardBack);

    const signTrimBack = signTrimFront.clone();
    signTrimBack.position.set(0, 7.2, -0.47);
    gateGroup.add(signTrimBack);

    const backSignPanel = new THREE.Mesh(new THREE.PlaneGeometry(9.5, 1.15), signMat);
    backSignPanel.position.set(0, 7.2, -0.58);
    backSignPanel.rotation.y = Math.PI;
    gateGroup.add(backSignPanel);

    // Welcoming Red Silk Lanterns
    [-4.5, 4.5].forEach(lx => {
      const lanternGroup = new THREE.Group();
      lanternGroup.position.set(lx, 6.2, 0);

      const lCord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.8), goldMat);
      lCord.position.y = 0.4;
      lanternGroup.add(lCord);

      const lBody = new THREE.Mesh(new THREE.SphereGeometry(0.42, 8, 8), new THREE.MeshLambertMaterial({ color: 0xd90429, emissive: 0x4a000d }));
      lBody.scale.set(1, 1.2, 1);
      lanternGroup.add(lBody);

      const lTassel = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.02, 0.6), goldMat);
      lTassel.position.y = -0.65;
      lanternGroup.add(lTassel);

      gateGroup.add(lanternGroup);
    });

    scene.add(gateGroup);
  }

  // Lightweight geometry merger utility to drastically reduce Three.js draw calls
  function mergeBufferGeometries(geos) {
    if (!geos || geos.length === 0) return new THREE.BufferGeometry();
    let totalPos = 0, totalNorm = 0, totalUv = 0, totalIdx = 0;
    for (let i = 0; i < geos.length; i++) {
      const g = geos[i];
      if (g.attributes.position) totalPos += g.attributes.position.array.length;
      if (g.attributes.normal) totalNorm += g.attributes.normal.array.length;
      if (g.attributes.uv) totalUv += g.attributes.uv.array.length;
      if (g.index) totalIdx += g.index.array.length;
    }
    const pos = new Float32Array(totalPos);
    const norm = totalNorm > 0 ? new Float32Array(totalNorm) : null;
    const uv = totalUv > 0 ? new Float32Array(totalUv) : null;
    const idx = (totalPos / 3 > 65535) ? new Uint32Array(totalIdx) : new Uint16Array(totalIdx);

    let pOff = 0, nOff = 0, uOff = 0, iOff = 0, vOff = 0;
    for (let i = 0; i < geos.length; i++) {
      const g = geos[i];
      if (g.attributes.position) {
        pos.set(g.attributes.position.array, pOff);
        pOff += g.attributes.position.array.length;
      }
      if (norm && g.attributes.normal) {
        norm.set(g.attributes.normal.array, nOff);
        nOff += g.attributes.normal.array.length;
      }
      if (uv && g.attributes.uv) {
        uv.set(g.attributes.uv.array, uOff);
        uOff += g.attributes.uv.array.length;
      }
      if (g.index) {
        const ga = g.index.array;
        for (let j = 0; j < ga.length; j++) {
          idx[iOff + j] = ga[j] + vOff;
        }
        iOff += ga.length;
      }
      vOff += g.attributes.position ? g.attributes.position.count : 0;
    }

    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (norm) merged.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
    if (uv) merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    if (totalIdx > 0) merged.setIndex(new THREE.BufferAttribute(idx, 1));
    return merged;
  }

  // Authentic Vietnamese Dragon Fruit Blossom (Hoa thanh long nở trắng ngà nhụy vàng rực rỡ)
  // Highly optimized: 2 pre-merged geometries (white petals + golden stamen core)
  let sharedFlowerPetalsGeo = null;
  let sharedFlowerCenterGeo = null;
  const flowerPetalMat = new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const flowerStamenMat = new THREE.MeshBasicMaterial({ color: 0xffd166 });

  function initSharedFlowerGeometries() {
    const stalk = new THREE.CylinderGeometry(0.038, 0.055, 0.16, 5);
    stalk.rotateX(Math.PI / 2);

    const petalGeos = [stalk];
    const sepalGeo = new THREE.ConeGeometry(0.045, 0.2, 4);
    sepalGeo.translate(0, 0.1, 0);
    for (let s = 0; s < 5; s++) {
      const sa = (s / 5) * Math.PI * 2;
      const g = sepalGeo.clone();
      g.rotateZ(sa - Math.PI / 2);
      g.rotateX(0.55);
      g.translate(Math.cos(sa) * 0.05, Math.sin(sa) * 0.05, 0.06);
      petalGeos.push(g);
    }
    const pGeo = new THREE.ConeGeometry(0.07, 0.26, 4);
    pGeo.translate(0, 0.13, 0);
    pGeo.scale(1.2, 1, 0.28);
    for (let p = 0; p < 7; p++) {
      const pa = (p / 7) * Math.PI * 2;
      const g = pGeo.clone();
      g.rotateZ(pa - Math.PI / 2);
      g.rotateX(0.62);
      g.translate(Math.cos(pa) * 0.065, Math.sin(pa) * 0.065, 0.11);
      petalGeos.push(g);
    }
    sharedFlowerPetalsGeo = mergeBufferGeometries(petalGeos);

    const stamen = new THREE.CylinderGeometry(0.045, 0.025, 0.15, 6);
    stamen.rotateX(Math.PI / 2);
    stamen.translate(0, 0, 0.15);
    sharedFlowerCenterGeo = stamen;
  }
  initSharedFlowerGeometries();

  function createWorldFlowerMesh() {
    const fg = new THREE.Group();
    const petals = new THREE.Mesh(sharedFlowerPetalsGeo, flowerPetalMat);
    const center = new THREE.Mesh(sharedFlowerCenterGeo, flowerStamenMat);
    fg.add(petals, center);
    fg.scale.set(0.85, 0.85, 0.85);
    return fg;
  }

  // Shared reusable geometries & materials for dragon fruit pillars & fruits across the entire orchard
  const sharedPillarMoundGeo = new THREE.CylinderGeometry(1.95, 2.35, 0.16, 16);
  const sharedPillarMoundMat = new THREE.MeshLambertMaterial({ color: 0x4a3421 }); // Bồn đất ủ rơm mục hữu cơ màu đất đậm tự nhiên
  const sharedPillarPostGeo = new THREE.BoxGeometry(0.5, 2.7, 0.5);
  const sharedPillarPostMat = new THREE.MeshLambertMaterial({ color: 0xb4bec7 });
  const sharedPillarMossMat = new THREE.MeshLambertMaterial({ color: 0x526b58 });
  const sharedPillarMossGeo = new THREE.BoxGeometry(0.52, 0.42, 0.52);
  const sharedPillarTrunkMat = new THREE.MeshLambertMaterial({ color: 0x1e7e34 });
  const sharedPillarTieMat = new THREE.MeshLambertMaterial({ color: 0xd4a373 });
  const sharedPillarBeamMat = new THREE.MeshLambertMaterial({ color: 0x555555 });
  const sharedPillarTyreGeo = new THREE.TorusGeometry(0.72, 0.15, 8, 14);
  sharedPillarTyreGeo.rotateX(Math.PI / 2);
  const sharedPillarTyreMat = new THREE.MeshLambertMaterial({ color: 0x212529 });
  const sharedPillarAuraGeo = new THREE.RingGeometry(1.88, 2.12, 24);
  const sharedPillarAuraMat = new THREE.MeshBasicMaterial({
    color: 0x10b981, // Vòng hào quang ngọc bích êm dịu, hài hòa với màu xanh của vườn
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.38
  });

  // Pre-merged static sub-parts for each pillar
  const trunkCurves = [
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.26, 0.18, 0.08),
      new THREE.Vector3(-0.26, 0.95, -0.06),
      new THREE.Vector3(-0.25, 1.85, 0.1),
      new THREE.Vector3(-0.18, 2.62, 0.05)
    ]),
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.08, 0.18, 0.26),
      new THREE.Vector3(-0.06, 0.92, 0.26),
      new THREE.Vector3(0.1, 1.9, 0.25),
      new THREE.Vector3(0.12, 2.62, 0.18)
    ]),
    new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.26, 0.18, -0.05),
      new THREE.Vector3(0.25, 1.05, 0.08),
      new THREE.Vector3(0.25, 1.95, -0.08),
      new THREE.Vector3(0.15, 2.62, -0.16)
    ])
  ];
  const sharedPillarTrunkGeo = mergeBufferGeometries(trunkCurves.map(c => new THREE.TubeGeometry(c, 6, 0.08, 3, false)));

  const sharedPillarTiesGeo = mergeBufferGeometries([0.85, 1.65, 2.35].map(ty => {
    const tg = new THREE.BoxGeometry(0.54, 0.045, 0.54);
    tg.translate(0, ty, 0);
    return tg;
  }));

  const b1 = new THREE.BoxGeometry(1.2, 0.07, 0.09);
  b1.translate(0, 2.62, 0);
  const b2 = new THREE.BoxGeometry(0.09, 0.07, 1.2);
  b2.translate(0, 2.62, 0);
  const sharedPillarBeamsGeo = mergeBufferGeometries([b1, b2]);

  const rootGeos = [-0.8, 0.9].map((rx, ri) => {
    const rc = new THREE.CatmullRomCurve3([
      new THREE.Vector3(rx * 0.3, 0.15, ri * 0.2),
      new THREE.Vector3(rx * 0.8, 0.14, ri * 0.7),
      new THREE.Vector3(rx * 1.4, 0.06, ri * 1.1)
    ]);
    return new THREE.TubeGeometry(rc, 4, 0.045, 3, false);
  });
  const sharedPillarRootsGeo = mergeBufferGeometries(rootGeos);
  const sharedPillarRootMat = new THREE.MeshLambertMaterial({ color: 0x5a3e1b });

  function createWorldFruitSkinTexture() {
    const c = document.createElement('canvas');
    c.width = 128;
    c.height = 128;
    const ctx = c.getContext('2d');

    const grad = ctx.createLinearGradient(0, 0, 0, 128);
    grad.addColorStop(0.0, '#1b380f'); // Cuống xanh đậm
    grad.addColorStop(0.12, '#6e0c24'); // Đỏ đô thẫm
    grad.addColorStop(0.65, '#881337'); // Đỏ đô chín mọng
    grad.addColorStop(0.90, '#58081c'); // Đáy quả huyết dụ
    grad.addColorStop(1.0, '#1d3e12'); // Họng hoa xanh đậm
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 128, 128);

    ctx.fillStyle = 'rgba(120, 13, 40, 0.45)';
    for (let x = 16; x < 128; x += 32) {
      ctx.fillRect(x, 15, 12, 95);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    return tex;
  }
  const worldFruitSkinTex = createWorldFruitSkinTexture();

  const sharedWorldFruitBodyMat = new THREE.MeshStandardMaterial({
    map: worldFruitSkinTex,
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0.0
  });
  const sharedWorldFruitEarMat = new THREE.MeshLambertMaterial({
    color: 0x9acd32, // Fresh chartreuse green ears
    side: THREE.DoubleSide
  });
  const sharedWorldFruitStrokedEarMat = new THREE.MeshLambertMaterial({
    color: 0x00e676,
    emissive: 0x003d1f,
    side: THREE.DoubleSide
  });

  // Pre-merged world fruit scales & stem geometry (12 curved ears + crown tip + top stem in 1 draw call!)
  let sharedWorldFruitCrownGeo = null;
  function initSharedFruitCrownGeo() {
    const parts = [];
    const bladeGeo = new THREE.ConeGeometry(0.045, 0.12, 4);
    bladeGeo.translate(0, 0.05, 0);
    bladeGeo.scale(1.2, 1, 0.35);

    // 3 tiers of scales wrapping the 0.11r body
    const tiers = [
      { y: 0.05, count: 4, rotX: -0.4, r: 0.10 },
      { y: -0.01, count: 4, rotX: -0.5, r: 0.11 },
      { y: -0.06, count: 4, rotX: -0.55, r: 0.10 }
    ];

    tiers.forEach((t, tIdx) => {
      for (let e = 0; e < t.count; e++) {
        const ea = (e / t.count) * Math.PI * 2 + (tIdx * 0.785);
        const g = bladeGeo.clone();
        g.rotateX(t.rotX);
        g.rotateY(ea);
        g.translate(Math.sin(ea) * t.r, t.y, Math.cos(ea) * t.r);
        parts.push(g);
      }
    });

    // Crown tip at bottom
    const crown = new THREE.ConeGeometry(0.055, 0.10, 5, 1, true);
    crown.rotateX(Math.PI);
    crown.translate(0, -0.19, 0);
    parts.push(crown);

    // Curved green stem at top connecting to vine branch
    const stemCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0.16, 0),
      new THREE.Vector3(0.03, 0.24, -0.02),
      new THREE.Vector3(0.08, 0.32, -0.06)
    ]);
    parts.push(new THREE.TubeGeometry(stemCurve, 4, 0.025, 3, false));

    sharedWorldFruitCrownGeo = mergeBufferGeometries(parts);
  }
  initSharedFruitCrownGeo();

  const sharedStarBadgeGeo = new THREE.RingGeometry(0.28, 0.33, 14);
  const sharedStarBadgeMat = new THREE.MeshBasicMaterial({ color: 0xffd700, side: THREE.DoubleSide });

  const vineColors = [
    new THREE.MeshLambertMaterial({ color: 0x1b5e20 }), // Deep mature succulent cactus green
    new THREE.MeshLambertMaterial({ color: 0x2e7d32 })  // Lush rich farm green
  ];

  // Pre-generate 3 distinct organic canopy models with natural cascading umbrella curves
  const vineCanopyPool = [];
  function initVineCanopyPool() {
    for (let v = 0; v < 3; v++) {
      const cGroup = new THREE.Group();
      const geos0 = [];
      const geos1 = [];
      const weepingCount = 14;
      for (let i = 0; i < weepingCount; i++) {
        const angle = (i / weepingCount) * Math.PI * 2 + v * 0.25;
        const reachR = 0.95 + (i % 3) * 0.12;
        const dropR = 1.15 + (i % 4) * 0.10;
        const dropY = 1.25 + (i % 3) * 0.12;
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(Math.sin(angle) * 0.22, 2.65, Math.cos(angle) * 0.22),
          new THREE.Vector3(Math.sin(angle) * reachR, 2.72 + (i % 2) * 0.05, Math.cos(angle) * reachR),
          new THREE.Vector3(Math.sin(angle) * (reachR + 0.15), 2.15, Math.cos(angle) * (reachR + 0.15)),
          new THREE.Vector3(Math.sin(angle) * dropR, dropY, Math.cos(angle) * dropR)
        ]);
        const tubeGeo = new THREE.TubeGeometry(curve, 7, 0.075, 3, false);
        if (i % 2 === 0) geos0.push(tubeGeo);
        else geos1.push(tubeGeo);
      }
      const crownCount = 8;
      for (let j = 0; j < crownCount; j++) {
        const cAngle = (j / crownCount) * Math.PI * 2 + 0.35 + v * 0.2;
        const cCurve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(0, 2.65, 0),
          new THREE.Vector3(Math.sin(cAngle) * 0.45, 2.85 + (j % 2) * 0.06, Math.cos(cAngle) * 0.45),
          new THREE.Vector3(Math.sin(cAngle) * 0.95, 2.45, Math.cos(cAngle) * 0.95)
        ]);
        const cTube = new THREE.TubeGeometry(cCurve, 6, 0.07, 3, false);
        if (j % 2 === 0) geos0.push(cTube);
        else geos1.push(cTube);
      }
      const m0 = new THREE.Mesh(mergeBufferGeometries(geos0), vineColors[0]);
      const m1 = new THREE.Mesh(mergeBufferGeometries(geos1), vineColors[1]);
      m0.castShadow = true;
      cGroup.add(m0, m1);
      vineCanopyPool.push(cGroup);
    }
  }
  initVineCanopyPool();

  // Create an authentic, lush Vietnamese Dragon Fruit Pillar with:
  // - Weathered square concrete post with lichen/moss base
  // - Woody climbing cactus trunks rooted in ground and hugging the concrete post
  // - Straw & organic mulch mound (bồn thanh long) with surface roots
  // - Top rubber tyre support bracket (vỏ xe đỡ cành) on crossbeam
  // - 22 lush cascading 3-ribbed succulent cactus vines in natural umbrella canopy
  // - 3 blooming giant white dragon fruit flowers with golden stamens
  // - 8 hanging realistic dragon fruits nestled along cascading branches
  function createDragonFruitPillar(id, x, z) {
    const group = new THREE.Group();
    const groundY = getTerrainHeight(x, z);
    group.position.set(x, groundY, z);

    // 1. Raised Earthen Straw Mulch Mound (Bồn thanh long phủ rơm rạ hữu cơ)
    const mound = new THREE.Mesh(sharedPillarMoundGeo, sharedPillarMoundMat);
    mound.position.y = 0.13;
    mound.receiveShadow = true;
    group.add(mound);

    // 2 surface roots spreading onto the mound (pre-merged)
    const roots = new THREE.Mesh(sharedPillarRootsGeo, sharedPillarRootMat);
    group.add(roots);

    // 2. Square Concrete Pillar Post (Trụ bê tông vuông rêu phong đặc trưng Bình Thuận)
    const post = new THREE.Mesh(sharedPillarPostGeo, sharedPillarPostMat);
    post.position.y = 1.35;
    post.castShadow = true;
    post.receiveShadow = true;
    group.add(post);

    // Mossy base collar around lower concrete post
    const mossCollar = new THREE.Mesh(sharedPillarMossGeo, sharedPillarMossMat);
    mossCollar.position.y = 0.35;
    group.add(mossCollar);

    // 3. Woody Main Climbing Cactus Trunks (pre-merged)
    const trunks = new THREE.Mesh(sharedPillarTrunkGeo, sharedPillarTrunkMat);
    group.add(trunks);

    // 3 straw/twine ties fastening the trunks to the concrete post (pre-merged)
    const ties = new THREE.Mesh(sharedPillarTiesGeo, sharedPillarTieMat);
    group.add(ties);

    // 4. Top Support Crossbeam & Tyre Bracket (pre-merged)
    const beams = new THREE.Mesh(sharedPillarBeamsGeo, sharedPillarBeamMat);
    const tyre = new THREE.Mesh(sharedPillarTyreGeo, sharedPillarTyreMat);
    tyre.position.y = 2.65;
    group.add(beams, tyre);

    // 5. 22 Lush Multi-Tier 3-Ribbed Cactus Vines (merged into ONLY 2 meshes!)
    const canopy = vineCanopyPool[id % 3].clone(true);
    canopy.rotation.y = (id * 1.37) % (Math.PI * 2);
    group.add(canopy);

    // 6. 3 Blooming Giant White Dragon Fruit Flowers with Golden Stamens (Hoa thanh long)
    const flowerAngles = [
      (id * 1.2) % (Math.PI * 2),
      (id * 1.2 + 2.1) % (Math.PI * 2),
      (id * 1.2 + 4.2) % (Math.PI * 2)
    ];
    flowerAngles.forEach((fa, fi) => {
      const flw = createWorldFlowerMesh();
      const flwR = 1.38;
      flw.position.set(Math.sin(fa) * flwR, 1.85 + (fi % 2) * 0.15, Math.cos(fa) * flwR);
      flw.lookAt(new THREE.Vector3(Math.sin(fa) * (flwR + 2), 1.75 + (fi % 2) * 0.15, Math.cos(fa) * (flwR + 2)));
      group.add(flw);
    });

    // 7. Hanging 3D Dragon Fruits nestled along the cascading branches (8 fruits in 2 tiers!)
    const fruitSlots = [];
    const fruitCount = 8;
    for (let f = 0; f < fruitCount; f++) {
      const tier = f < 4 ? 0 : 1;
      const tierIndex = f % 4;
      const fAngle = (tierIndex / 4) * Math.PI * 2 + (tier * 0.785) + (id % 5) * 0.22;
      const reachR = tier === 0 ? 1.28 : 1.12;
      const fx = Math.sin(fAngle) * reachR;
      const fz = Math.cos(fAngle) * reachR;
      const fy = tier === 0 ? (1.38 + (tierIndex % 2) * 0.06) : (1.68 + (tierIndex % 2) * 0.06);

      const fruitMeshGroup = createWorldFruitMesh();
      fruitMeshGroup.position.set(fx, fy, fz);
      fruitMeshGroup.rotation.y = fAngle;
      group.add(fruitMeshGroup);

      fruitSlots.push({
        index: f,
        angle: fAngle,
        meshGroup: fruitMeshGroup,
        stroked: false
      });
    }

    // 8. Ground Ring Indicator (Vòng hào quang tương tác hồng neon nhẹ)
    const auraRing = new THREE.Mesh(sharedPillarAuraGeo, sharedPillarAuraMat);
    auraRing.rotation.x = -Math.PI / 2;
    auraRing.position.y = 0.27;
    group.add(auraRing);

    scene.add(group);

    const pillarObj = {
      id,
      x,
      y: groundY,
      z,
      group,
      post,
      fruitSlots,
      auraRing,
      get remainingCount() {
        return this.fruitSlots.filter(s => !s.stroked).length;
      }
    };

    post.userData.pillarObj = pillarObj;
    return pillarObj;
  }

  // Create a realistic miniature 3D Dragon Fruit hanging on the world pillar (Lightweight LOD for 60-120fps)
  function createWorldFruitMesh() {
    const fg = new THREE.Group();
    const body = new THREE.Mesh(sharedWorldFruitBodyGeo, sharedWorldFruitBodyMat);
    body.castShadow = false;
    body.receiveShadow = false;
    const crown = new THREE.Mesh(sharedWorldFruitCrownGeo, sharedWorldFruitEarMat);
    crown.castShadow = false;
    crown.receiveShadow = false;
    fg.add(body, crown);
    fg.userData = { body, crown };
    return fg;
  }

  function markWorldFruitAsStroked(slot) {
    slot.stroked = true;
    if (slot.meshGroup && slot.meshGroup.userData) {
      const { crown } = slot.meshGroup.userData;
      if (crown) {
        crown.material = sharedWorldFruitStrokedEarMat;
      }
    }

    // Add a golden star badge on the stroked fruit
    const halo = new THREE.Mesh(sharedStarBadgeGeo, sharedStarBadgeMat);
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 0.35;
    slot.meshGroup.add(halo);
  }

  // Overhead Electric Cable Grid connecting pillars & Night Lamps
  function buildOrchardNightLampNetwork(rows, cols) {
    const bulbGeo = new THREE.SphereGeometry(0.2, 8, 8);
    const bulbMatOff = new THREE.MeshLambertMaterial({ color: 0xdfe6e9 });
    const bulbMatOn = new THREE.MeshBasicMaterial({ color: 0xffb703 });
    const wireMat = new THREE.MeshBasicMaterial({ color: 0x1e293b });

    rows.forEach((z) => {
      for (let i = 0; i < cols.length - 1; i++) {
        const x1 = cols[i];
        const x2 = cols[i + 1];
        // Don't cross the central avenue between negative and positive x
        if (x1 < 0 && x2 > 0) continue;

        const y1 = getTerrainHeight(x1, z) + 3.2;
        const y2 = getTerrainHeight(x2, z) + 3.2;
        const midX = (x1 + x2) / 2;
        const midY = (y1 + y2) / 2 - 0.22;

        const wireCurve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(x1, y1, z),
          new THREE.Vector3(midX, midY, z),
          new THREE.Vector3(x2, y2, z)
        ]);
        const wire = new THREE.Mesh(new THREE.TubeGeometry(wireCurve, 8, 0.015, 4, false), wireMat);
        scene.add(wire);

        const bulb = new THREE.Mesh(bulbGeo, bulbMatOff);
        bulb.position.set(midX, midY - 0.12, z);
        scene.add(bulb);
        nightBulbMeshes.push({ mesh: bulb, matOff: bulbMatOff, matOn: bulbMatOn });
      }
    });

    const lightCoords = [
      [-28, 6, -35], [28, 6, -35],
      [-28, 6, -14], [28, 6, -14],
      [-28, 6, 14],  [28, 6, 14],
      [-28, 6, 35],  [28, 6, 35],
      [0, 6, 28],    [0, 6, -28]
    ];
    lightCoords.forEach(([lx, ly, lz]) => {
      const pLight = new THREE.PointLight(0xffbe0b, 0, 52, 1.8);
      pLight.position.set(lx, getTerrainHeight(lx, lz) + ly, lz);
      scene.add(pLight);
      nightLights.push(pLight);
    });
  }

  // Scenic Distant Ta Cu Mountain Ridges (Layered Atmospheric Depth)
  function buildDistantMountains() {
    const mtnGroup = new THREE.Group();

    // 3 Tiers of Sculpted Mountain Ridges (Layered Atmospheric Depth)
    // Tier 1: Foreground Rolling Foothills
    const tier1Mat = new THREE.MeshStandardMaterial({ color: 0x27553b, roughness: 0.9 });
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2 + 0.15;
      const dist = 125 + Math.sin(i * 3.5) * 12;
      const r = 26 + (i % 5) * 5;
      const h = 22 + (i % 4) * 8 + Math.random() * 4;
      const mtnGeo = new THREE.SphereGeometry(r, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5);
      const mtn = new THREE.Mesh(mtnGeo, tier1Mat);
      mtn.scale.set(1.0, h / r, 1.2 + Math.sin(i) * 0.3);
      mtn.position.set(Math.sin(angle) * dist, 0, Math.cos(angle) * dist);
      mtn.rotation.y = angle;
      mtnGroup.add(mtn);
    }

    // Tier 2: Mid-range Majestic Ta Cu Peaks
    const tier2Mat = new THREE.MeshStandardMaterial({ color: 0x1d433e, roughness: 0.92 });
    for (let i = 0; i < 28; i++) {
      const angle = (i / 28) * Math.PI * 2 + 0.35;
      const dist = 165 + Math.cos(i * 2.8) * 18;
      const r = 38 + (i % 6) * 7;
      const h = 42 + (i % 5) * 14 + Math.random() * 6;
      const mtnGeo = new THREE.SphereGeometry(r, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5);
      const mtn = new THREE.Mesh(mtnGeo, tier2Mat);
      mtn.scale.set(1.1, h / r, 1.3);
      mtn.position.set(Math.sin(angle) * dist, -2, Math.cos(angle) * dist);
      mtn.rotation.y = angle + 0.4;
      mtnGroup.add(mtn);
    }

    // Tier 3: Far Horizon Misty Mountain Crests
    const tier3Mat = new THREE.MeshStandardMaterial({ color: 0x22364a, roughness: 0.95 });
    for (let i = 0; i < 20; i++) {
      const angle = (i / 20) * Math.PI * 2;
      const dist = 215 + Math.sin(i * 4.1) * 22;
      const r = 55 + (i % 4) * 10;
      const h = 65 + (i % 3) * 18;
      const mtnGeo = new THREE.SphereGeometry(r, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5);
      const mtn = new THREE.Mesh(mtnGeo, tier3Mat);
      mtn.scale.set(1.2, h / r, 1.4);
      mtn.position.set(Math.sin(angle) * dist, -5, Math.cos(angle) * dist);
      mtn.rotation.y = angle;
      mtnGroup.add(mtn);
    }

    scene.add(mtnGroup);
  }

  // Coconut Palms & Windbreak Flora
  function buildOrchardFlora() {
    // 1. Coconut Palms along Central Avenue & Canal
    const palmPositions = [
      [-6.5, 48], [6.5, 48],
      [-6.5, 28], [6.5, 28],
      [-6.5, -4], [6.5, -4],
      [-6.5, -34], [6.5, -34],
      [-48, 35], [-48, 0], [-48, -35]
    ];
    palmPositions.forEach(([px, pz], idx) => {
      const palm = createCoconutPalm(px, pz, 0.9 + (idx % 3) * 0.15);
      scene.add(palm);
    });

    // 2. Windbreak Trees along Outer Perimeter Fences
    for (let i = -60; i <= 60; i += 12) {
      scene.add(createCasuarinaTree(64, i, 1.0 + Math.random() * 0.2));
      scene.add(createCasuarinaTree(i, -64, 1.0 + Math.random() * 0.2));
      if (Math.abs(i) > 10) {
        scene.add(createCasuarinaTree(i, 64, 1.0 + Math.random() * 0.2));
      }
    }
  }

  function createCoconutPalm(x, z, scale = 1) {
    const palm = new THREE.Group();
    palm.position.set(x, getTerrainHeight(x, z), z);

    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0.4 * scale, 3.5 * scale, 0.2 * scale),
      new THREE.Vector3(0.8 * scale, 7.5 * scale, 0.5 * scale)
    ]);
    const trunkGeo = new THREE.TubeGeometry(curve, 8, 0.32 * scale, 6, false);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x784f2b, roughness: 0.88 });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.castShadow = true;
    palm.add(trunk);

    const frondMat = new THREE.MeshStandardMaterial({ color: 0x1e7e34, roughness: 0.7, side: THREE.DoubleSide });
    const frondCount = 7;
    for (let f = 0; f < frondCount; f++) {
      const angle = (f / frondCount) * Math.PI * 2;
      const frondCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(Math.sin(angle) * 1.8 * scale, 0.8 * scale, Math.cos(angle) * 1.8 * scale),
        new THREE.Vector3(Math.sin(angle) * 3.6 * scale, -0.6 * scale, Math.cos(angle) * 3.6 * scale)
      ]);
      const leafTube = new THREE.TubeGeometry(frondCurve, 6, 0.12 * scale, 3, false);
      const leaf = new THREE.Mesh(leafTube, frondMat);
      leaf.position.set(0.8 * scale, 7.5 * scale, 0.5 * scale);
      palm.add(leaf);
    }

    const nutGeo = new THREE.SphereGeometry(0.24 * scale, 6, 6);
    const nutMat = new THREE.MeshStandardMaterial({ color: 0x543d2b, roughness: 0.8 });
    for (let n = 0; n < 3; n++) {
      const nut = new THREE.Mesh(nutGeo, nutMat);
      nut.position.set(0.8 * scale + Math.sin(n * 2) * 0.3 * scale, 7.3 * scale, 0.5 * scale + Math.cos(n * 2) * 0.3 * scale);
      palm.add(nut);
    }

    return palm;
  }

  function createCasuarinaTree(x, z, scale = 1) {
    const g = new THREE.Group();
    g.position.set(x, getTerrainHeight(x, z), z);

    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22 * scale, 0.32 * scale, 3.6 * scale, 6),
      new THREE.MeshStandardMaterial({ color: 0x423122, roughness: 0.9 })
    );
    trunk.position.y = 1.8 * scale;
    trunk.castShadow = true;
    g.add(trunk);

    const foliageColors = [0x1c4e2b, 0x235e35, 0x184425];
    for (let c = 0; c < 3; c++) {
      const cone = new THREE.Mesh(
        new THREE.ConeGeometry((1.9 - c * 0.38) * scale, 2.9 * scale, 8),
        new THREE.MeshStandardMaterial({ color: foliageColors[c % foliageColors.length], roughness: 0.85 })
      );
      cone.position.y = (3.2 + c * 1.6) * scale;
      cone.castShadow = (c === 0);
      g.add(cone);
    }
    return g;
  }

  // 35+ 3D Wildflower Clumps, Mossy Boulders & Tropical Shade Trees (High performance merged LOD)
  function buildScatterFlora() {
    const floraGroup = new THREE.Group();

    // 1. Colorful 3D Wildflower Clumps (Hoa dại đồng quê phong cách Ghibli)
    const flowerColors = [0xfacc15, 0xffffff, 0xc084fc, 0xfb923c, 0xf43f5e];
    const stemMat = new THREE.MeshLambertMaterial({ color: 0x3f6212 });
    const stemGeo = new THREE.CylinderGeometry(0.02, 0.025, 0.38, 4);
    const bloomGeo = new THREE.SphereGeometry(0.12, 5, 5);

    for (let i = 0; i < 32; i++) {
      let fx = (Math.random() - 0.5) * 110;
      let fz = (Math.random() - 0.5) * 110;
      if (Math.abs(fx) < 4.5 && fz > -50 && fz < 55) continue; // Keep main road clear

      const clump = new THREE.Group();
      clump.position.set(fx, getTerrainHeight(fx, fz), fz);
      const col = flowerColors[i % flowerColors.length];
      const petalMat = new THREE.MeshLambertMaterial({ color: col });

      const stemParts = [];
      const bloomParts = [];
      const count = 3 + (i % 3);
      for (let c = 0; c < count; c++) {
        const ox = (Math.random() - 0.5) * 0.45;
        const oz = (Math.random() - 0.5) * 0.45;
        const sg = stemGeo.clone();
        sg.translate(ox, 0.19, oz);
        stemParts.push(sg);

        const bg = bloomGeo.clone();
        bg.translate(ox, 0.38, oz);
        bloomParts.push(bg);
      }
      const sMesh = new THREE.Mesh(mergeBufferGeometries(stemParts), stemMat);
      const bMesh = new THREE.Mesh(mergeBufferGeometries(bloomParts), petalMat);
      clump.add(sMesh, bMesh);
      floraGroup.add(clump);
    }

    // 2. Mossy Granite Boulders scattered on the landscape
    const boulderGeo = new THREE.DodecahedronGeometry(1.4, 1);
    const boulderMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.85 });
    for (let i = 0; i < 22; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = 55 + Math.random() * 40;
      const bx = Math.sin(angle) * dist;
      const bz = Math.cos(angle) * dist;
      const by = getTerrainHeight(bx, bz);
      const bld = new THREE.Mesh(boulderGeo, boulderMat);
      const s = 0.8 + Math.random() * 1.2;
      bld.scale.set(s, s * (0.6 + Math.random() * 0.5), s * (0.8 + Math.random() * 0.4));
      bld.position.set(bx, by + s * 0.35, bz);
      bld.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
      bld.receiveShadow = true;
      floraGroup.add(bld);
      rockColliders.push({ x: bx, z: bz, r: s * 1.2 });
    }

    // 3. Majestic Tropical Shade Trees (Cây bóng mát vòm lá bồng bềnh kiểu Genshin / Ghibli)
    const treePositions = [
      [52, 42], [54, 15], [52, -22], [54, -48],
      [-36, 52], [28, 54], [-38, -52], [32, -54]
    ];
    treePositions.forEach(([tx, tz]) => {
      floraGroup.add(createTropicalShadeTree(tx, tz));
      rockColliders.push({ x: tx, z: tz, r: 0.85 });
    });

    scene.add(floraGroup);
  }

  function createTropicalShadeTree(x, z) {
    const tree = new THREE.Group();
    tree.position.set(x, getTerrainHeight(x, z), z);

    // Gnarled organic woody trunk
    const trunkCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3((Math.random() - 0.5) * 0.8, 3.2, (Math.random() - 0.5) * 0.8),
      new THREE.Vector3((Math.random() - 0.5) * 1.2, 6.5, (Math.random() - 0.5) * 1.2)
    ]);
    const trunkGeo = new THREE.TubeGeometry(trunkCurve, 8, 0.65, 7, false);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x54361c, roughness: 0.88 });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.castShadow = true;
    tree.add(trunk);

    // Fluffy Organic Cloud-like Foliage Clusters (Multi-sphere canopy)
    const foliageColors = [0x2e7d32, 0x388e3c, 0x1b5e20, 0x43a047];
    const canopyPuffs = [
      { x: 0, y: 7.2, z: 0, r: 2.8 },
      { x: -1.6, y: 6.8, z: 1.2, r: 2.2 },
      { x: 1.8, y: 6.9, z: -1.0, r: 2.4 },
      { x: 1.0, y: 7.8, z: 1.4, r: 2.0 },
      { x: -1.2, y: 8.0, z: -1.2, r: 2.1 }
    ];

    canopyPuffs.forEach((puff, idx) => {
      const leafGeo = new THREE.DodecahedronGeometry(puff.r, 1);
      const leafMat = new THREE.MeshStandardMaterial({
        color: foliageColors[idx % foliageColors.length],
        roughness: 0.75
      });
      const puffMesh = new THREE.Mesh(leafGeo, leafMat);
      puffMesh.position.set(puff.x, puff.y, puff.z);
      puffMesh.castShadow = true;
      puffMesh.receiveShadow = true;
      tree.add(puffMesh);
    });

    return tree;
  }

  // Farmer's Thatch-Roof Gazebo / Resting Hut ("Chòi nghỉ mát nông dân")
  function buildFarmerGazebo(x, z) {
    const hut = new THREE.Group();
    hut.position.set(x, getTerrainHeight(x, z), z);

    const woodMat = new THREE.MeshStandardMaterial({ color: 0x5c381e, roughness: 0.85 });
    const thatchMat = new THREE.MeshStandardMaterial({ color: 0xb5894b, roughness: 0.95 });

    // 4 Weathered Bamboo Posts
    const postGeo = new THREE.CylinderGeometry(0.18, 0.22, 3.6, 8);
    [[-2.4, -1.8], [2.4, -1.8], [-2.4, 1.8], [2.4, 1.8]].forEach(([px, pz]) => {
      const p = new THREE.Mesh(postGeo, woodMat);
      p.position.set(px, 1.8, pz);
      p.castShadow = true;
      hut.add(p);
    });

    // Traditional Thatched Roof with overhang
    const roofGeo = new THREE.ConeGeometry(5.4, 2.5, 4);
    roofGeo.rotateY(Math.PI / 4);
    const roof = new THREE.Mesh(roofGeo, thatchMat);
    roof.position.y = 4.4;
    roof.castShadow = true;
    hut.add(roof);

    // Bougainvillea Floral Vine climbing the front-left post (Hoa giấy rực rỡ)
    const vineMat = new THREE.MeshStandardMaterial({ color: 0x2e7d32, roughness: 0.8 });
    const flowerMat = new THREE.MeshStandardMaterial({ color: 0xe11d48, roughness: 0.6 });
    for (let v = 0; v < 16; v++) {
      const vy = 0.5 + v * 0.2;
      const vAngle = v * 0.9;
      const leafPuff = new THREE.Mesh(new THREE.SphereGeometry(0.16, 5, 5), vineMat);
      leafPuff.position.set(-2.4 + Math.sin(vAngle) * 0.22, vy, 1.8 + Math.cos(vAngle) * 0.22);
      hut.add(leafPuff);

      if (v % 2 === 0) {
        const fl = new THREE.Mesh(new THREE.SphereGeometry(0.14, 5, 5), flowerMat);
        fl.position.set(-2.4 + Math.sin(vAngle) * 0.28, vy + 0.05, 1.8 + Math.cos(vAngle) * 0.28);
        hut.add(fl);
      }
    }

    // Bamboo Resting Bed (Chõng tre)
    const bedGeo = new THREE.BoxGeometry(3.2, 0.12, 1.6);
    const bed = new THREE.Mesh(bedGeo, new THREE.MeshStandardMaterial({ color: 0xd4a359, roughness: 0.8 }));
    bed.position.set(0, 0.55, 0);
    bed.castShadow = true;
    hut.add(bed);

    // Clay Rainwater Jar (Lu nước sành Bình Thuận)
    const jarGeo = new THREE.SphereGeometry(0.52, 10, 10);
    const jar = new THREE.Mesh(jarGeo, new THREE.MeshStandardMaterial({ color: 0x9a3412, roughness: 0.7 }));
    jar.scale.set(1, 1.3, 1);
    jar.position.set(2.8, 0.65, -1.2);
    jar.castShadow = true;
    hut.add(jar);

    // Tea Set Table
    const table = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.6, 8), woodMat);
    table.position.set(-1.0, 0.3, 0);
    hut.add(table);

    // Teapot
    const pot = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 6), new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.4 }));
    pot.position.set(-1.0, 0.68, 0);
    hut.add(pot);

    scene.add(hut);
  }

  // Meandering S-Curve River, Riverbank Stones & Arched Footbridge
  function buildScenicStreamAndBridge() {
    const streamGroup = new THREE.Group();

    // S-curve Riverbed
    const riverSegments = 36;
    const riverWidth = 6.2;
    const riverGeo = new THREE.PlaneGeometry(riverWidth, 130, 4, riverSegments);
    riverGeo.rotateX(-Math.PI / 2);

    const pos = riverGeo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i);
      const curveOffset = Math.sin(z * 0.05) * 5.2;
      pos.setX(i, pos.getX(i) + curveOffset - 54);
      pos.setY(i, getRiverWaterHeight(z));
    }
    riverGeo.computeVertexNormals();

    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      map: waterCanalTex,
      roughness: 0.15,
      metalness: 0.65,
      transparent: true,
      opacity: 0.92
    });
    waterCanalMesh = new THREE.Mesh(riverGeo, waterMat);
    waterCanalMesh.receiveShadow = true;
    streamGroup.add(waterCanalMesh);

    // Natural Riverbank Stones along both banks
    const rockGeo = new THREE.DodecahedronGeometry(1.0, 1);
    const rockMats = [
      new THREE.MeshStandardMaterial({ color: 0x52606d, roughness: 0.85 }),
      new THREE.MeshStandardMaterial({ color: 0x627d98, roughness: 0.8 }),
      new THREE.MeshStandardMaterial({ color: 0x486581, roughness: 0.9 })
    ];

    for (let z = -60; z <= 60; z += 3.8) {
      const curveX = -54 + Math.sin(z * 0.05) * 5.2;
      [-1, 1].forEach(side => {
        if (Math.abs(z) < 5) return;
        const rk = new THREE.Mesh(rockGeo, rockMats[Math.floor(Math.random() * rockMats.length)]);
        const scale = 0.45 + Math.random() * 0.55;
        rk.scale.set(scale * (0.8 + Math.random() * 0.4), scale * 0.7, scale * (0.8 + Math.random() * 0.4));
        const bankOffset = (riverWidth * 0.52 + Math.random() * 0.7) * side;
        const rx = curveX + bankOffset;
        const rz = z + (Math.random() - 0.5) * 1.5;
        rk.position.set(rx, getTerrainHeight(rx, rz) + scale * 0.25, rz);
        rk.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, 0);
        rk.receiveShadow = true;
        streamGroup.add(rk);
        rockColliders.push({ x: rx, z: rz, r: scale * 0.75 });
      });
    }

    // Traditional Arched Red-wood Moon Bridge (Cầu Gỗ Cong Bắt Qua Suối) at z = 0
    const bridgeGroup = new THREE.Group();
    const bridgeWaterY = getRiverWaterHeight(0);
    bridgeGroup.position.set(-54, bridgeWaterY + 0.1, 0);

    const bridgeWoodMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.75 });
    const archPlankCount = 14;
    const archRadius = 5.2;
    for (let p = 0; p < archPlankCount; p++) {
      const t = (p / (archPlankCount - 1)) - 0.5;
      const angle = t * 1.2;
      const bx = Math.sin(angle) * archRadius;
      const by = Math.cos(angle) * archRadius - archRadius * Math.cos(0.6) + 0.15;

      const plank = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.12, 2.6), bridgeWoodMat);
      plank.position.set(bx, by, 0);
      plank.rotation.z = -angle;
      plank.castShadow = true;
      plank.receiveShadow = true;
      bridgeGroup.add(plank);
    }

    // Curved Handrails
    [-1.2, 1.2].forEach(rz => {
      const railMat = new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.7 });
      for (let post = -3; post <= 3; post += 1.5) {
        const t = post / 4.0;
        const angle = t * 0.6;
        const bx = Math.sin(angle) * archRadius;
        const by = Math.cos(angle) * archRadius - archRadius * Math.cos(0.6) + 0.15;
        const postMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.85, 6), railMat);
        postMesh.position.set(bx, by + 0.42, rz);
        postMesh.castShadow = true;
        bridgeGroup.add(postMesh);
      }
      const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(-4.0, 0.4, rz),
        new THREE.Vector3(-2.0, 0.95, rz),
        new THREE.Vector3(0, 1.2, rz),
        new THREE.Vector3(2.0, 0.95, rz),
        new THREE.Vector3(4.0, 0.4, rz)
      ]);
      const railGeo = new THREE.TubeGeometry(curve, 16, 0.05, 6, false);
      const railMesh = new THREE.Mesh(railGeo, railMat);
      railMesh.castShadow = true;
      bridgeGroup.add(railMesh);
    });

    streamGroup.add(bridgeGroup);

    // Floating Lotus Water Lily Pads & Blossoms
    const padMat = new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.6 });
    const lotusPetalMat = new THREE.MeshStandardMaterial({ color: 0xf472b6, roughness: 0.5 });
    const lotusWhiteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    const stamenMat = new THREE.MeshBasicMaterial({ color: 0xfacc15 });

    for (let i = 0; i < 30; i++) {
      const z = (Math.random() - 0.5) * 110;
      if (Math.abs(z) < 4) continue;
      const curveX = -54 + Math.sin(z * 0.05) * 5.2 + (Math.random() - 0.5) * 3.8;
      const padR = 0.32 + Math.random() * 0.22;
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(padR, padR, 0.02, 10), padMat);
      const wY = getRiverWaterHeight(z);
      pad.position.set(curveX, wY + 0.02, z);
      pad.rotation.y = Math.random() * Math.PI;
      streamGroup.add(pad);

      if (Math.random() > 0.45) {
        const lotusGroup = new THREE.Group();
        lotusGroup.position.set(curveX, wY + 0.04, z);
        const petalMat = Math.random() > 0.3 ? lotusPetalMat : lotusWhiteMat;
        for (let p = 0; p < 6; p++) {
          const pAngle = (p / 6) * Math.PI * 2;
          const petal = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.22, 5), petalMat);
          petal.position.set(Math.sin(pAngle) * 0.08, 0.1, Math.cos(pAngle) * 0.08);
          petal.rotation.x = Math.PI * 0.15;
          petal.rotation.y = pAngle;
          lotusGroup.add(petal);
        }
        const stamen = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.08, 6), stamenMat);
        stamen.position.y = 0.09;
        lotusGroup.add(stamen);
        streamGroup.add(lotusGroup);
      }
    }

    scene.add(streamGroup);
  }

  // Celestial Sky Dome, Drifting Clouds, Sun & Moon
  function buildSkyAndAtmosphere() {
    // 1. Procedural Celestial Sky Dome (Immersive panoramic gradient)
    const skyGeo = new THREE.SphereGeometry(265, 32, 24);
    const skyMat = new THREE.MeshBasicMaterial({
      map: state.isNight ? skyNightTex : skyDayTex,
      side: THREE.BackSide,
      depthWrite: false
    });
    skyDomeMesh = new THREE.Mesh(skyGeo, skyMat);
    scene.add(skyDomeMesh);

    // 2. Procedural Puffy Volumetric Cumulus Clouds
    const cloudMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.95,
      transparent: true,
      opacity: 0.92
    });

    for (let i = 0; i < 14; i++) {
      const cg = new THREE.Group();
      const pCount = 5 + Math.floor(Math.random() * 4);
      for (let p = 0; p < pCount; p++) {
        const geo = new THREE.DodecahedronGeometry(3.5 + Math.random() * 2.5, 1);
        const m = new THREE.Mesh(geo, cloudMat);
        m.position.set(
          p * 3.2 - (pCount * 1.6),
          (Math.random() - 0.5) * 1.5,
          (Math.random() - 0.5) * 2.5
        );
        cg.add(m);
      }
      cg.position.set(
        (Math.random() - 0.5) * 220,
        48 + Math.random() * 16,
        (Math.random() - 0.5) * 220
      );
      cg.userData = { speed: 1.2 + Math.random() * 0.8 };
      cloudsGroup.add(cg);
    }

    // 3. Radiant Sun Disk
    const sunGeo = new THREE.SphereGeometry(6.0, 16, 16);
    const sunMat = new THREE.MeshBasicMaterial({ color: 0xfffae0 });
    sunMesh = new THREE.Mesh(sunGeo, sunMat);
    sunMesh.position.set(90, 110, 80);
    scene.add(sunMesh);

    // 4. Glowing Crescent Moon
    const moonGeo = new THREE.SphereGeometry(4.8, 16, 16);
    const moonMat = new THREE.MeshBasicMaterial({ color: 0xffeaa7 });
    moonMesh = new THREE.Mesh(moonGeo, moonMat);
    moonMesh.position.set(-80, 95, -70);
    moonMesh.visible = false;
    scene.add(moonMesh);

    // 5. Shimmering Fireflies for Night
    const fireflyGeo = new THREE.SphereGeometry(0.1, 4, 4);
    const fireflyMat = new THREE.MeshBasicMaterial({ color: 0xa3e635 });
    for (let i = 0; i < 42; i++) {
      const ff = new THREE.Mesh(fireflyGeo, fireflyMat);
      ff.position.set(
        (Math.random() - 0.5) * 80,
        1.2 + Math.random() * 2.5,
        (Math.random() - 0.5) * 80
      );
      ff.userData = {
        baseX: ff.position.x,
        baseZ: ff.position.z,
        seed: Math.random() * Math.PI * 2
      };
      firefliesGroup.add(ff);
    }
    firefliesGroup.visible = false;
  }

  function buildPerimeterDecorations() {
    // Bamboo Perimeter Fences
    const fenceMat = new THREE.MeshLambertMaterial({ color: 0xd4a373 });
    const postGeo = new THREE.CylinderGeometry(0.08, 0.08, 1.4, 6);
    const railGeo = new THREE.CylinderGeometry(0.05, 0.05, 4.2, 6);
    railGeo.rotateZ(Math.PI / 2);

    for (let z = -58; z <= 58; z += 4.2) {
      const gy = getTerrainHeight(62, z);
      const p1 = new THREE.Mesh(postGeo, fenceMat);
      p1.position.set(62, gy + 0.7, z);
      scene.add(p1);

      const gyRail = getTerrainHeight(62, z + 2.1);
      const r1 = new THREE.Mesh(railGeo, fenceMat);
      r1.position.set(62, gyRail + 0.9, z + 2.1);
      scene.add(r1);
    }

    // Stacks of Dragon Fruit Harvest Crates near Entrance
    const crateGeo = new THREE.BoxGeometry(1.4, 0.8, 1.0);
    const crateColors = [0xeb1a5a, 0x0284c7, 0x059669, 0xf59e0b];
    for (let i = 0; i < 14; i++) {
      const cx = -8.5 - (i % 3) * 1.55;
      const cz = 52 - (i % 2) * 1.5;
      const gy = getTerrainHeight(cx, cz);
      const crate = new THREE.Mesh(
        crateGeo,
        new THREE.MeshLambertMaterial({ color: crateColors[i % crateColors.length] })
      );
      crate.position.set(cx, gy + 0.4 + Math.floor(i / 3) * 0.82, cz);
      crate.castShadow = true;
      scene.add(crate);
    }
  }

  // Update dynamic environment (clouds drift, fireflies dance, river flows)
  function updateEnvironment(dt) {
    // 1. Clouds gently drifting across the sky
    if (cloudsGroup) {
      cloudsGroup.children.forEach(cg => {
        cg.position.x += dt * (cg.userData.speed || 1.5);
        if (cg.position.x > 140) {
          cg.position.x = -140;
        }
      });
    }

    // 2. Fireflies dancing in the night air
    if (state.isNight && firefliesGroup && firefliesGroup.visible) {
      const t = performance.now() * 0.002;
      firefliesGroup.children.forEach(ff => {
        const u = ff.userData;
        ff.position.x = u.baseX + Math.sin(t + u.seed) * 1.4;
        ff.position.z = u.baseZ + Math.cos(t * 0.8 + u.seed) * 1.4;
        ff.position.y = 1.2 + Math.abs(Math.sin(t * 1.5 + u.seed)) * 1.6;
      });
    }

    // 3. Gentle meandering stream flowing animation
    if (waterCanalTex) {
      waterCanalTex.offset.y += dt * 0.05;
    }
  }

  // Build Orchard first so pillars[] is populated!
  buildOrchardEnvironment();

  // ==========================================
  // 5. 3D CHIBI FARMER CHARACTER BUILDER (Animal Crossing / Genshin Mini Cute Style)
  // ==========================================
  // Authentic Vietnamese Dragon Fruit SVG Badge for 3D Nametags & Leaderboard
  function getDragonFruitBadgeHtml() {
    return `<svg class="dragonfruit-badge-icon" viewBox="0 0 24 24" width="14" height="14" fill="none">
      <path d="M12 2C8.5 6 6 11 6 16c0 3.5 2.7 6 6 6s6-2.5 6-6c0-5-2.5-10-6-14z" fill="#ff1361"/>
      <path d="M12 2c-1.8 3.5-3.5 6-4.5 9 .8-1.5 2.2-2.5 4.5-2.5s3.7 1 4.5 2.5c-1-3-2.7-5.5-4.5-9z" fill="#ffd166"/>
      <path d="M7.5 11c-2 2-2.8 4.5-2 6.5 1.5-.5 2.5-1.5 3-3-.2-1.2-.5-2.3-1-3.5z" fill="#00f298"/>
      <path d="M16.5 11c2 2 2.8 4.5 2 6.5-1.5-.5-2.5-1.5-3-3 .2-1.2.5-2.3 1-3.5z" fill="#00f298"/>
      <path d="M9 16c-.5 1.8 0 3.2 1.2 4.2 1-.5 1.5-1.5 1.8-2.7-.8-.4-1.8-.8-3-1.5z" fill="#ffd166"/>
      <path d="M15 16c.5 1.8 0 3.2-1.2 4.2-1-.5-1.5-1.5-1.8-2.7.8-.4 1.8-.8 3-1.5z" fill="#ffd166"/>
      <path d="M12 1c-.3 1-.2 1.8.2 2.5.4-.7.5-1.5.2-2.5-.2 0-.3 0-.4 0z" fill="#22c55e"/>
    </svg>`;
  }

  // Traditional Vietnamese Hats Builder
  function buildTaiBeoHat(hatGroup) {
    while (hatGroup.children.length > 0) {
      hatGroup.remove(hatGroup.children[0]);
    }
    hatGroup.rotation.set(0, 0, 0);

    const brim = new THREE.Mesh(
      new THREE.CylinderGeometry(0.55, 0.58, 0.05, 24),
      new THREE.MeshLambertMaterial({ color: 0x2e7d32 })
    );
    brim.castShadow = true;

    const crown = new THREE.Mesh(
      new THREE.CylinderGeometry(0.33, 0.36, 0.22, 20),
      new THREE.MeshLambertMaterial({ color: 0x256029 })
    );
    crown.position.y = 0.11;
    crown.castShadow = true;

    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(0.362, 0.362, 0.045, 20),
      new THREE.MeshLambertMaterial({ color: 0x1b431e })
    );
    band.position.y = 0.035;

    hatGroup.add(brim, crown, band);

    // Chin strap looping snugly under jaw
    const strapCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.32, -0.02, 0.02),
      new THREE.Vector3(-0.22, -0.38, 0.08),
      new THREE.Vector3(0, -0.64, 0.12),
      new THREE.Vector3(0.22, -0.38, 0.08),
      new THREE.Vector3(0.32, -0.02, 0.02)
    ]);
    const strapGeo = new THREE.TubeGeometry(strapCurve, 20, 0.010, 5, false);
    const strap = new THREE.Mesh(strapGeo, new THREE.MeshLambertMaterial({ color: 0x1b431e }));
    hatGroup.add(strap);
  }

  function buildNonLaHat(hatGroup) {
    while (hatGroup.children.length > 0) {
      hatGroup.remove(hatGroup.children[0]);
    }
    hatGroup.rotation.set(0.06, 0, -0.06);

    // Iconic Vietnamese Conical Nón Lá Body
    const coneGeo = new THREE.ConeGeometry(0.52, 0.35, 32, 1, true);
    const coneMat = new THREE.MeshStandardMaterial({
      map: nonLaTexture,
      roughness: 0.72,
      metalness: 0.06,
      side: THREE.DoubleSide
    });
    const cone = new THREE.Mesh(coneGeo, coneMat);
    cone.position.y = 0.12;
    cone.castShadow = true;
    hatGroup.add(cone);

    // Golden bamboo rim hoop (Vành cạp chân nón lá)
    const rimGeo = new THREE.TorusGeometry(0.52, 0.012, 6, 32);
    rimGeo.rotateX(Math.PI / 2);
    const bambooMat = new THREE.MeshLambertMaterial({ color: 0xb45309 });
    const rim = new THREE.Mesh(rimGeo, bambooMat);
    rim.position.y = -0.055;
    hatGroup.add(rim);

    // Shiny apex spire cap (Chóp nón bọc đồng vàng óng ả)
    const apexGeo = new THREE.ConeGeometry(0.056, 0.08, 16);
    const apexMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      roughness: 0.32,
      metalness: 0.65
    });
    const apex = new THREE.Mesh(apexGeo, apexMat);
    apex.position.y = 0.30;
    hatGroup.add(apex);

    // Traditional Vietnamese Lotus Pink Silk Ribbon (Quai nón lụa mềm mại buông dưới cằm)
    const ribbonCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.34, -0.05, 0.02),
      new THREE.Vector3(-0.24, -0.40, 0.08),
      new THREE.Vector3(0, -0.66, 0.13),
      new THREE.Vector3(0.24, -0.40, 0.08),
      new THREE.Vector3(0.34, -0.05, 0.02)
    ]);
    const ribbonGeo = new THREE.TubeGeometry(ribbonCurve, 24, 0.012, 6, false);
    const ribbonMat = new THREE.MeshLambertMaterial({ color: 0xf43f5e });
    const strap = new THREE.Mesh(ribbonGeo, ribbonMat);
    hatGroup.add(strap);

    // Dainty knotted ribbon bow under the chin (Nơ lụa thắt duyên dáng dưới cằm)
    const bowG = new THREE.Group();
    bowG.position.set(0, -0.66, 0.14);
    const bowLoopGeo = new THREE.TorusGeometry(0.038, 0.009, 6, 12, Math.PI * 1.6);
    const bowLeft = new THREE.Mesh(bowLoopGeo, ribbonMat);
    bowLeft.rotation.z = 0.55;
    bowLeft.position.set(-0.035, -0.01, 0);
    const bowRight = new THREE.Mesh(bowLoopGeo, ribbonMat);
    bowRight.rotation.z = -0.55;
    bowRight.position.set(0.035, -0.01, 0);
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.018, 6, 6), ribbonMat);
    bowG.add(bowLeft, bowRight, knot);
    hatGroup.add(bowG);
  }

  function createFarmerAvatar({ name, shirtColor, hatType, isSelf = false }) {
    const root = new THREE.Group();

    // 1. Torso Group & Áo Bà Ba Chibi
    const torsoGroup = new THREE.Group();
    torsoGroup.position.y = 0.72;

    const torsoGeo = new THREE.CylinderGeometry(0.30, 0.39, 0.68, 16);
    const torsoMat = new THREE.MeshLambertMaterial({ color: shirtColor });
    const torso = new THREE.Mesh(torsoGeo, torsoMat);
    torso.castShadow = true;
    torsoGroup.add(torso);

    // Traditional white mandarin inner collar band (Cổ áo bà ba viền trắng)
    const collarGeo = new THREE.TorusGeometry(0.22, 0.02, 6, 20);
    collarGeo.rotateX(Math.PI / 2);
    const collarMat = new THREE.MeshLambertMaterial({ color: 0xf8fafc });
    const collar = new THREE.Mesh(collarGeo, collarMat);
    collar.position.set(0, 0.34, 0);
    torsoGroup.add(collar);

    // Central placket strip (Nẹp cài cúc áo)
    const placketGeo = new THREE.BoxGeometry(0.045, 0.62, 0.015);
    const placket = new THREE.Mesh(placketGeo, torsoMat);
    placket.position.set(0, -0.02, 0.35);
    torsoGroup.add(placket);

    // 4 Glossy Pearl Buttons (Cúc áo ngọc trai trắng tròn)
    const buttonMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.2,
      metalness: 0.1
    });
    const buttonGeo = new THREE.SphereGeometry(0.022, 8, 8);
    [0.20, 0.07, -0.06, -0.19].forEach(by => {
      const btn = new THREE.Mesh(buttonGeo, buttonMat);
      btn.position.set(0, by, 0.36);
      torsoGroup.add(btn);
    });

    // Two Patch Pockets (2 Túi áo bà ba truyền thống)
    const pocketMat = new THREE.MeshLambertMaterial({ color: 0x334155 });
    const pocketGeo = new THREE.BoxGeometry(0.12, 0.13, 0.02);

    const rightPocket = new THREE.Mesh(pocketGeo, pocketMat);
    rightPocket.position.set(0.18, -0.14, 0.34);
    torsoGroup.add(rightPocket);

    const leftPocket = new THREE.Mesh(pocketGeo, pocketMat);
    leftPocket.position.set(-0.18, -0.14, 0.34);
    torsoGroup.add(leftPocket);

    // Gardening shears (Kéo tỉa cành cán đỏ)
    const shearsMat = new THREE.MeshLambertMaterial({ color: 0xd63031 });
    const shearGeo = new THREE.CylinderGeometry(0.011, 0.011, 0.10, 5);
    const shear1 = new THREE.Mesh(shearGeo, shearsMat);
    shear1.position.set(0.16, -0.04, 0.35);
    shear1.rotation.z = 0.22;
    const shear2 = new THREE.Mesh(shearGeo, shearsMat);
    shear2.position.set(0.20, -0.04, 0.35);
    shear2.rotation.z = -0.22;
    torsoGroup.add(shear1, shear2);

    // Khăn Rằn Nam Bộ quàng cổ
    const scarfMat = new THREE.MeshLambertMaterial({
      map: khanRanTexture,
      side: THREE.DoubleSide
    });
    const scarfNeckGeo = new THREE.TorusGeometry(0.26, 0.055, 8, 24);
    scarfNeckGeo.rotateX(Math.PI / 2);
    const scarfNeck = new THREE.Mesh(scarfNeckGeo, scarfMat);
    scarfNeck.position.set(0, 0.34, 0);
    torsoGroup.add(scarfNeck);

    // Scarf tail hanging over left shoulder with fringes (Dải khăn rằn vắt qua vai có tua rua)
    const scarfTailGroup = new THREE.Group();
    scarfTailGroup.position.set(-0.16, 0.16, 0.33);
    scarfTailGroup.rotation.z = 0.08;

    const scarfTailGeo = new THREE.BoxGeometry(0.11, 0.36, 0.026);
    const scarfTailMesh = new THREE.Mesh(scarfTailGeo, scarfMat);
    scarfTailMesh.position.y = 0;
    scarfTailGroup.add(scarfTailMesh);

    // Scarf fringe tassels (Tua rua đuôi khăn rằn)
    const fringeMat = new THREE.MeshBasicMaterial({ color: 0xf8fafc });
    for (let fi = -0.045; fi <= 0.045; fi += 0.018) {
      const fringe = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.04, 4), fringeMat);
      fringe.position.set(fi, -0.19, 0);
      scarfTailGroup.add(fringe);
    }
    torsoGroup.add(scarfTailGroup);

    root.add(torsoGroup);

    // 2. Head Group & Cute Anime Chibi Face
    const headGroup = new THREE.Group();
    headGroup.position.y = 1.42;

    const headGeo = new THREE.SphereGeometry(0.38, 24, 24);
    const skinMat = new THREE.MeshLambertMaterial({ color: 0xffe2cc }); // Warm glowing rosy peach skin
    const head = new THREE.Mesh(headGeo, skinMat);
    head.castShadow = true;
    headGroup.add(head);

    // Cute Chibi Ears
    function createEar(isRight) {
      const earG = new THREE.Group();
      earG.position.set(isRight ? 0.37 : -0.37, -0.01, 0.03);
      earG.rotation.y = isRight ? 0.2 : -0.2;
      const outerEar = new THREE.Mesh(
        new THREE.SphereGeometry(0.072, 10, 10),
        skinMat
      );
      outerEar.scale.set(0.4, 0.85, 0.65);
      const innerEarMat = new THREE.MeshBasicMaterial({ color: 0xfca5a5 });
      const innerEar = new THREE.Mesh(
        new THREE.CircleGeometry(0.035, 8),
        innerEarMat
      );
      innerEar.position.set(isRight ? 0.03 : -0.03, 0, 0.01);
      innerEar.rotation.y = isRight ? Math.PI / 2 : -Math.PI / 2;
      earG.add(outerEar, innerEar);
      return earG;
    }
    headGroup.add(createEar(false), createEar(true));

    // Stylized Anime Chibi Hair (Mái tóc layer bồng bềnh tự nhiên)
    const hairMat = new THREE.MeshLambertMaterial({ color: 0x2e1a12 }); // Deep silky warm espresso
    const backHairGeo = new THREE.SphereGeometry(0.392, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.65);
    const backHair = new THREE.Mesh(backHairGeo, hairMat);
    backHair.rotation.x = -0.35;
    backHair.position.set(0, 0.02, -0.02);
    headGroup.add(backHair);

    // Side locks framing cheeks (Tóc mai hai bên duyên dáng)
    const leftSideburn = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.20, 8), hairMat);
    leftSideburn.position.set(-0.35, -0.06, 0.14);
    leftSideburn.rotation.set(0.2, 0, 0.15);
    const rightSideburn = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.20, 8), hairMat);
    rightSideburn.position.set(0.35, -0.06, 0.14);
    rightSideburn.rotation.set(0.2, 0, -0.15);
    headGroup.add(leftSideburn, rightSideburn);

    // Sweeping anime bangs peeking neatly under hat brim
    function createBangTuft(x, y, z, rx, ry, rz, sx, sy, sz) {
      const tuftGeo = new THREE.ConeGeometry(0.08, 0.20, 8);
      const tuft = new THREE.Mesh(tuftGeo, hairMat);
      tuft.position.set(x, y, z);
      tuft.rotation.set(rx, ry, rz);
      tuft.scale.set(sx, sy, sz);
      return tuft;
    }
    headGroup.add(createBangTuft(-0.08, 0.23, 0.33, -0.3, 0.1, 0.25, 0.9, 1.1, 0.7));
    headGroup.add(createBangTuft(0.08, 0.24, 0.33, -0.28, -0.1, -0.22, 0.9, 1.05, 0.7));
    headGroup.add(createBangTuft(-0.20, 0.19, 0.32, -0.2, 0.2, 0.45, 0.8, 0.9, 0.6));
    headGroup.add(createBangTuft(0.20, 0.19, 0.32, -0.2, -0.2, -0.45, 0.8, 0.9, 0.6));

    // Sparkling Anime Eyes (Đôi mắt anime long lanh có hồn)
    function createAnimeEye(isRight = false) {
      const eyeG = new THREE.Group();

      // White sclera
      const scleraMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const scleraGeo = new THREE.CircleGeometry(0.062, 16);
      scleraGeo.scale(0.9, 1.22, 1);
      const sclera = new THREE.Mesh(scleraGeo, scleraMat);
      eyeG.add(sclera);

      // Deep warm Iris
      const irisMat = new THREE.MeshBasicMaterial({ color: 0x26140e });
      const irisGeo = new THREE.CircleGeometry(0.054, 16);
      irisGeo.scale(0.88, 1.18, 1);
      const iris = new THREE.Mesh(irisGeo, irisMat);
      iris.position.z = 0.002;
      eyeG.add(iris);

      // Warm amber glow in lower iris
      const amberMat = new THREE.MeshBasicMaterial({ color: 0xd97706 });
      const amberGeo = new THREE.CircleGeometry(0.038, 12, Math.PI, Math.PI);
      amberGeo.scale(0.85, 0.5, 1);
      const amber = new THREE.Mesh(amberGeo, amberMat);
      amber.position.set(0, -0.015, 0.003);
      eyeG.add(amber);

      // Pupil core
      const pupilMat = new THREE.MeshBasicMaterial({ color: 0x090503 });
      const pupilGeo = new THREE.CircleGeometry(0.032, 12);
      pupilGeo.scale(0.85, 1.1, 1);
      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      pupil.position.set(0, 0.005, 0.004);
      eyeG.add(pupil);

      // Primary glossy sparkle
      const sparkMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const bigSpark = new THREE.Mesh(new THREE.CircleGeometry(0.020, 8), sparkMat);
      bigSpark.position.set(0.015, 0.024, 0.006);
      
      // Secondary micro sparkle
      const smallSpark = new THREE.Mesh(new THREE.CircleGeometry(0.010, 6), sparkMat);
      smallSpark.position.set(-0.016, -0.018, 0.006);
      eyeG.add(bigSpark, smallSpark);

      // Eyelash upper arch with cute wing
      const lashMat = new THREE.MeshBasicMaterial({ color: 0x18181b });
      const lashGeo = new THREE.TorusGeometry(0.056, 0.008, 4, 10, Math.PI * 0.75);
      const lash = new THREE.Mesh(lashGeo, lashMat);
      lash.rotation.z = isRight ? Math.PI * 0.12 : -Math.PI * 0.12;
      lash.position.set(0, 0.040, 0.006);
      eyeG.add(lash);

      return eyeG;
    }

    const leftEye = createAnimeEye(false);
    leftEye.position.set(-0.14, 0.03, 0.355);
    leftEye.rotation.y = -0.15;
    const rightEye = createAnimeEye(true);
    rightEye.position.set(0.14, 0.03, 0.355);
    rightEye.rotation.y = 0.15;
    headGroup.add(leftEye, rightEye);

    // Cheerful Eyebrows (Lông mày thanh tú)
    const browMat = new THREE.MeshBasicMaterial({ color: 0x3d2314 });
    const browGeo = new THREE.TorusGeometry(0.065, 0.007, 4, 8, Math.PI * 0.5);
    const leftBrow = new THREE.Mesh(browGeo, browMat);
    leftBrow.position.set(-0.14, 0.14, 0.355);
    leftBrow.rotation.z = 0.25;
    leftBrow.rotation.y = -0.15;
    const rightBrow = new THREE.Mesh(browGeo, browMat);
    rightBrow.position.set(0.14, 0.14, 0.355);
    rightBrow.rotation.z = -0.25;
    rightBrow.rotation.y = 0.15;
    headGroup.add(leftBrow, rightBrow);

    // Rosy Blush Cheeks (Má hồng đào Chibi ngọt ngào)
    const blushMat = new THREE.MeshBasicMaterial({ color: 0xf43f5e, transparent: true, opacity: 0.55 });
    const blushGeo = new THREE.CircleGeometry(0.065, 12);
    blushGeo.scale(1.2, 0.75, 1);
    const leftBlush = new THREE.Mesh(blushGeo, blushMat);
    leftBlush.position.set(-0.21, -0.06, 0.33);
    leftBlush.rotation.y = -0.32;
    const rightBlush = new THREE.Mesh(blushGeo, blushMat);
    rightBlush.position.set(0.21, -0.06, 0.33);
    rightBlush.rotation.y = 0.32;

    const cheekDotMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 });
    const cheekDotGeo = new THREE.CircleGeometry(0.012, 6);
    const leftCheekDot = new THREE.Mesh(cheekDotGeo, cheekDotMat);
    leftCheekDot.position.set(0.02, 0.01, 0.002);
    leftBlush.add(leftCheekDot);
    const rightCheekDot = new THREE.Mesh(cheekDotGeo, cheekDotMat);
    rightCheekDot.position.set(-0.02, 0.01, 0.002);
    rightBlush.add(rightCheekDot);

    headGroup.add(leftBlush, rightBlush);

    // Sweet Happy Smile (Miệng cười tươi tắn)
    const mouthMat = new THREE.MeshBasicMaterial({ color: 0xe11d48 });
    const mouthGeo = new THREE.TorusGeometry(0.038, 0.008, 4, 10, Math.PI * 0.85);
    const mouth = new THREE.Mesh(mouthGeo, mouthMat);
    mouth.rotation.x = Math.PI;
    mouth.position.set(0, -0.15, 0.36);
    headGroup.add(mouth);

    // 3. Traditional Vietnamese Hat / Farmer Bucket Hat
    const hatGroup = new THREE.Group();
    hatGroup.position.set(0, 0.34, 0);

    if (hatType === 'taibeo') {
      buildTaiBeoHat(hatGroup);
    } else {
      buildNonLaHat(hatGroup);
    }
    headGroup.add(hatGroup);
    root.add(headGroup);

    // 4. Arms & White Cotton Stroking Gloves (Găng tay vải trắng vuốt ngoe)
    const gloveMat = new THREE.MeshLambertMaterial({ color: 0xf8fafc });
    const sleeveGeo = new THREE.CylinderGeometry(0.088, 0.076, 0.36, 12);
    const cuffGeo = new THREE.TorusGeometry(0.082, 0.016, 6, 16);
    cuffGeo.rotateX(Math.PI / 2);

    // Left Arm Group
    const leftArmGroup = new THREE.Group();
    leftArmGroup.position.set(-0.38, 0.98, 0);
    const leftSleeve = new THREE.Mesh(sleeveGeo, torsoMat);
    leftSleeve.position.y = -0.18;
    leftSleeve.castShadow = true;
    const leftCuff = new THREE.Mesh(cuffGeo, gloveMat);
    leftCuff.position.y = -0.34;
    const leftGlove = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 12), gloveMat);
    leftGlove.position.y = -0.40;
    leftGlove.castShadow = true;
    // Chibi thumb
    const leftThumb = new THREE.Mesh(new THREE.SphereGeometry(0.032, 6, 6), gloveMat);
    leftThumb.position.set(0.06, -0.38, 0.04);
    leftArmGroup.add(leftSleeve, leftCuff, leftGlove, leftThumb);
    root.add(leftArmGroup);

    // Right Arm Group
    const rightArmGroup = new THREE.Group();
    rightArmGroup.position.set(0.38, 0.98, 0);
    const rightSleeve = new THREE.Mesh(sleeveGeo, torsoMat);
    rightSleeve.position.y = -0.18;
    rightSleeve.castShadow = true;
    const rightCuff = new THREE.Mesh(cuffGeo, gloveMat);
    rightCuff.position.y = -0.34;
    const rightGlove = new THREE.Mesh(new THREE.SphereGeometry(0.085, 12, 12), gloveMat);
    rightGlove.position.y = -0.40;
    rightGlove.castShadow = true;
    const rightThumb = new THREE.Mesh(new THREE.SphereGeometry(0.032, 6, 6), gloveMat);
    rightThumb.position.set(-0.06, -0.38, 0.04);
    rightArmGroup.add(rightSleeve, rightCuff, rightGlove, rightThumb);
    root.add(rightArmGroup);

    // 5. Legs & Legendary Vietnamese Honeycomb Sandals (Đôi dép tổ ong huyền thoại)
    const legGeo = new THREE.CylinderGeometry(0.12, 0.11, 0.34, 12);
    const pantsMat = new THREE.MeshLambertMaterial({ color: 0x1e272e }); // Black silk trousers
    const cuffPantsMat = new THREE.MeshLambertMaterial({ color: 0x334155 }); // Rolled cuffs
    const sandalMat = new THREE.MeshLambertMaterial({ color: 0xfef08a }); // Creamy yellow honeycomb rubber

    function createLegWithSandal(isRight = false) {
      const legG = new THREE.Group();
      legG.position.set(isRight ? 0.16 : -0.16, 0.38, 0);

      const pants = new THREE.Mesh(legGeo, pantsMat);
      pants.position.y = -0.12;
      pants.castShadow = true;
      legG.add(pants);

      // Rolled pant cuffs
      const pantCuffGeo = new THREE.TorusGeometry(0.114, 0.016, 6, 16);
      pantCuffGeo.rotateX(Math.PI / 2);
      const pantCuff = new THREE.Mesh(pantCuffGeo, cuffPantsMat);
      pantCuff.position.y = -0.28;
      legG.add(pantCuff);

      // Legendary Dép tổ ong (Sole + Honeycomb Upper Strap)
      const sole = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.05, 0.27), sandalMat);
      sole.position.set(0, -0.33, 0.04);
      sole.castShadow = true;
      
      const strap = new THREE.Mesh(new THREE.TorusGeometry(0.076, 0.022, 6, 14, Math.PI), sandalMat);
      strap.position.set(0, -0.29, 0.06);
      strap.rotation.x = -Math.PI * 0.15;
      legG.add(sole, strap);

      return legG;
    }

    const leftLeg = createLegWithSandal(false);
    const rightLeg = createLegWithSandal(true);
    root.add(leftLeg, rightLeg);

    scene.add(root);

    const labelEl = document.createElement('div');
    labelEl.className = 'player-label-3d';
    labelEl.innerHTML = `
      <div class="chat-bubble-3d hidden"></div>
      <div class="nametag-3d ${isSelf ? 'is-self' : ''}">
        <span class="nametag-text">${name}</span>
        <span class="nametag-score"><span class="score-num">0</span>${getDragonFruitBadgeHtml()}</span>
      </div>
    `;
    labelsContainer.appendChild(labelEl);

    return {
      root,
      torso: torsoGroup,
      torsoMat,
      headGroup,
      scarfTail: scarfTailGroup,
      hatGroup,
      leftArm: leftArmGroup,
      rightArm: rightArmGroup,
      leftLeg,
      rightLeg,
      labelEl,
      chatBubbleEl: labelEl.querySelector('.chat-bubble-3d'),
      nameTextEl: labelEl.querySelector('.nametag-text'),
      scoreTextEl: labelEl.querySelector('.nametag-score'),
      walkPhase: Math.random() * 10,
      isStrokingAnim: false,
      chatTimeout: null,
      score: 0,
      name,
      shirtColor,
      hatType,
      setShirtColor(col) {
        this.shirtColor = col;
        torsoMat.color.set(col);
      },
      setHatType(newHat) {
        this.hatType = newHat;
        if (newHat === 'taibeo') {
          buildTaiBeoHat(this.hatGroup);
        } else {
          buildNonLaHat(this.hatGroup);
        }
      },
      setChat(message) {
        this.chatBubbleEl.textContent = message;
        this.chatBubbleEl.classList.remove('hidden');
        clearTimeout(this.chatTimeout);
        this.chatTimeout = setTimeout(() => {
          this.chatBubbleEl.classList.add('hidden');
        }, 5500);
      },
      updateScore(newScore) {
        this.score = newScore;
        this.scoreTextEl.innerHTML = `<span class="score-num">${newScore}</span>${getDragonFruitBadgeHtml()}`;
      },
      animate(dt, isMoving, isSprinting = false) {
        if (this.isStrokingAnim) {
          this.walkPhase += dt * 12;
          this.rightArm.rotation.x = -Math.PI * 0.65 + Math.sin(this.walkPhase) * 0.35;
          this.leftArm.rotation.x = -0.3;
          this.leftLeg.rotation.x = 0;
          this.rightLeg.rotation.x = 0;
        } else if (isMoving) {
          const cadence = isSprinting ? 9.8 : 6.8;
          this.walkPhase += dt * cadence;
          const swing = Math.sin(this.walkPhase) * (isSprinting ? 0.62 : 0.46);
          this.leftLeg.rotation.x = swing;
          this.rightLeg.rotation.x = -swing;
          this.leftArm.rotation.x = -swing * 0.75;
          this.rightArm.rotation.x = swing * 0.75;

          // Cute Chibi Head Bobbing & Scarf Sway
          if (this.headGroup) {
            this.headGroup.position.y = 1.42 + Math.abs(Math.sin(this.walkPhase * 2)) * 0.032;
          }
          if (this.scarfTail) {
            this.scarfTail.rotation.x = 0.08 + Math.sin(this.walkPhase) * 0.12;
          }
          if (this.hatGroup) {
            const baseTilt = this.hatType === 'taibeo' ? 0.0 : -0.09;
            const wobble = this.hatType === 'taibeo' ? 0.02 : 0.035;
            this.hatGroup.rotation.z = baseTilt + Math.sin(this.walkPhase) * wobble;
          }
        } else {
          this.leftLeg.rotation.x *= 0.8;
          this.rightLeg.rotation.x *= 0.8;
          this.leftArm.rotation.x *= 0.8;
          this.rightArm.rotation.x *= 0.8;

          // Cute Chibi Idle Breathing & Tilting
          this.walkPhase += dt * 2.2;
          if (this.torso) {
            this.torso.position.y = 0.72 + Math.sin(this.walkPhase * 2) * 0.012;
          }
          if (this.headGroup) {
            this.headGroup.rotation.z = Math.sin(this.walkPhase) * 0.035;
            this.headGroup.position.y = 1.42 + Math.sin(this.walkPhase * 2) * 0.008;
          }
          if (this.hatGroup) {
            const baseTilt = this.hatType === 'taibeo' ? 0.0 : -0.09;
            this.hatGroup.rotation.z = baseTilt;
          }
        }
      }
    };
  }

  // ==========================================
  // 6. SELF PLAYER & NPC FARMERS
  // ==========================================
  const player = createFarmerAvatar({
    name: state.playerName,
    shirtColor: state.shirtColor,
    hatType: state.hatType,
    isSelf: true
  });
  // Spawn player in a clear spot on the main road facing North (-Z) into the orchard!
  player.root.position.set(0, getWalkSurfaceHeight(0, 34), 34);
  player.root.rotation.y = Math.PI;
  player.updateScore(state.fruitsStroked);

  const NPC_PROFILES = [
    { name: 'Bác Ba Bình Thuận', color: '#0984e3', hat: 'nonla' },
    { name: 'Út Mót Chợ Gạo', color: '#e84393', hat: 'nonla' },
    { name: 'Tèo Hàm Thuận Nam', color: '#00b894', hat: 'taibeo' },
    { name: 'Cô Tư Long An', color: '#fdcb6e', hat: 'nonla' },
    { name: 'Hùng Phan Thiết', color: '#6c5ce7', hat: 'taibeo' },
    { name: 'Bé Bảy Tiền Giang', color: '#ff7675', hat: 'nonla' },
    { name: 'Chú Sáu Vườn Cồ', color: '#d63031', hat: 'taibeo' },
    { name: 'Ngọc Nhi Sài Gòn', color: '#e84393', hat: 'nonla' },
    { name: 'Minh Khôi Đồng Nai', color: '#00cec9', hat: 'taibeo' },
    { name: 'Thím Tám Tuy Phong', color: '#e17055', hat: 'nonla' },
    { name: 'Hoàng Lâm Bắc Bình', color: '#0984e3', hat: 'taibeo' }
  ];

  const NPC_CHATS = [
    'Trụ bên này trái thanh long bự múp míp bà con ơi! 🌸',
    'Nhớ vuốt từ gốc ra ngọn cho tai thẳng đứng nha!',
    'Năm nay thanh long trúng mùa, xuất đi Dubai mỏi tay!',
    'Ai phụ tui vuốt hàng trụ bên trái với! 🖐️',
    'Ngoe xanh mướt thế này thương lái mê tít luôn!',
    'Trời mát đi vuốt ngoe thanh long vui ghê ✨',
    'Chong đèn lên nhìn nguyên vườn đẹp như lễ hội!',
    'Cố lên anh em, sắp đầy xe container rồi! 🚛'
  ];

  const npcFarmers = NPC_PROFILES.map((prof) => {
    const avatar = createFarmerAvatar({
      name: prof.name,
      shirtColor: prof.color,
      hatType: prof.hat,
      isSelf: false
    });
    const targetPillar = pillars[Math.floor(Math.random() * pillars.length)];
    const nx = targetPillar.x + (Math.random() - 0.5) * 8;
    const nz = targetPillar.z + (Math.random() - 0.5) * 8;
    avatar.root.position.set(nx, getTerrainHeight(nx, nz), nz);
    avatar.updateScore(3 + Math.floor(Math.random() * 18));

    const tpx = targetPillar.x + 1.9;
    const tpz = targetPillar.z + 1.9;
    return {
      avatar,
      state: 'walking',
      targetPillar,
      targetPos: new THREE.Vector3(tpx, getTerrainHeight(tpx, tpz), tpz),
      timer: 2 + Math.random() * 5
    };
  });

  function updateNPCs(dt) {
    npcFarmers.forEach((npc) => {
      if (npc.state === 'walking') {
        npc.avatar.isStrokingAnim = false;
        const pos = npc.avatar.root.position;
        const dx = npc.targetPos.x - pos.x;
        const dz = npc.targetPos.z - pos.z;
        const dist = Math.hypot(dx, dz);

        if (dist > 0.35) {
          const speed = 3.5;
          pos.x += (dx / dist) * speed * dt;
          pos.z += (dz / dist) * speed * dt;
          pos.y = getWalkSurfaceHeight(pos.x, pos.z);
          npc.avatar.root.rotation.y = Math.atan2(dx, dz);
          npc.avatar.animate(dt, true);
        } else {
          npc.state = 'working';
          npc.timer = 4 + Math.random() * 5;
          npc.avatar.isStrokingAnim = true;
          npc.avatar.root.rotation.y = Math.atan2(
            npc.targetPillar.x - pos.x,
            npc.targetPillar.z - pos.z
          );
          if (Math.random() < 0.25) {
            const msg = NPC_CHATS[Math.floor(Math.random() * NPC_CHATS.length)];
            npc.avatar.setChat(msg);
          }
        }
      } else {
        npc.avatar.animate(dt, false);
        npc.timer -= dt;
        if (npc.timer <= 0) {
          if (Math.random() < 0.45) {
            npc.avatar.updateScore(npc.avatar.score + 1);
          }
          const nextPillar = pillars[Math.floor(Math.random() * pillars.length)];
          npc.targetPillar = nextPillar;
          const angle = Math.random() * Math.PI * 2;
          const tx = nextPillar.x + Math.sin(angle) * 2.1;
          const tz = nextPillar.z + Math.cos(angle) * 2.1;
          npc.targetPos.set(tx, getTerrainHeight(tx, tz), tz);
          npc.state = 'walking';
        }
      }
    });
  }

  // ==========================================
  // 7. REALISTIC 3D CLOSE-UP DRAGON FRUIT EAR STROKING
  // ==========================================
  const closeupGroup = new THREE.Group();
  closeupGroup.visible = false;
  scene.add(closeupGroup);

  const closeupFruitTurntable = new THREE.Group();
  closeupGroup.add(closeupFruitTurntable);

  let closeupEars = [];
  let closeupColliderMeshes = [];
  const closeupParticles = [];
  const raycaster = new THREE.Raycaster();
  const pointerNDC = new THREE.Vector2();
  let isSwipingCloseup = false;
  let isRotatingCloseupFruit = false;

  function buildCloseup3DFruit() {
    while (closeupFruitTurntable.children.length > 0) {
      closeupFruitTurntable.remove(closeupFruitTurntable.children[0]);
    }
    closeupEars = [];
    closeupColliderMeshes = [];
    activeCloseupMeshes = [];
    state.fruitSpinY = 0;
    closeupFruitTurntable.rotation.set(0, 0, 0);

    // 1. ADD REALISTIC 3D DRAGON FRUIT (Authentic 3D PBR Model with Retracted Ears)
    if (realisticGLBScene) {
      const fruitGroup = new THREE.Group();

      realisticGLBScene.traverse((child) => {
        if (child.isMesh && child.geometry && child.geometry.userData && child.geometry.userData.tuckPositions) {
          const cloneGeo = child.geometry.clone();

          // Initialize with retracted/tucked ears: fruit appears with ears removed / flat dormant scale buds
          cloneGeo.attributes.position.array.set(child.geometry.userData.tuckPositions);
          cloneGeo.attributes.position.needsUpdate = true;
          cloneGeo.computeVertexNormals();
          cloneGeo.userData = child.geometry.userData; // Retain morph target buffers

          const cloneMat = child.material.clone();
          applyDoDoFruitShader(cloneMat);

          const cloneMesh = new THREE.Mesh(cloneGeo, cloneMat);
          cloneMesh.castShadow = true;
          cloneMesh.receiveShadow = true;
          cloneMesh.userData.isFruitBody = true;

          fruitGroup.add(cloneMesh);
          activeCloseupMeshes.push(cloneMesh);
          closeupColliderMeshes.push(cloneMesh);
        }
      });

      fruitGroup.scale.set(1.75, 1.75, 1.75);
      fruitGroup.position.set(0, 0, 0);
      closeupFruitTurntable.add(fruitGroup);

      // 2. SETUP 12 DYNAMIC EAR GROWTH ZONES ON THE AUTHENTIC 3D GLB MODEL
      const hitSphereGeo = new THREE.SphereGeometry(0.24, 8, 8);
      const hitSphereMat = new THREE.MeshBasicMaterial({ visible: false });

      // Glowing bud indicator geometry (gentle sparkling ring & center bud)
      const budRingGeo = new THREE.RingGeometry(0.04, 0.08, 16);
      const budCenterGeo = new THREE.SphereGeometry(0.035, 8, 8);

      GLB_EAR_ZONES.forEach((spec, idx) => {
        const earPivot = new THREE.Group();

        // Exact 3D coordinates on the surface of the fruit
        const radius = (calcGLBBodyRadius(spec.y) + 0.04) * 1.75;
        const sx = Math.cos(spec.angle) * radius;
        const sy = spec.y * 1.75;
        const sz = Math.sin(spec.angle) * radius;
        earPivot.position.set(sx, sy, sz);

        // Invisible raycast collider for clicking & swiping
        const collider = new THREE.Mesh(hitSphereGeo, hitSphereMat);
        earPivot.add(collider);

        // Interactive visual guide: soft sparkling bud indicator
        const indGroup = new THREE.Group();
        const budMat = new THREE.MeshBasicMaterial({
          color: 0xffd54f,
          transparent: true,
          opacity: 0.85,
          side: THREE.DoubleSide
        });
        const budCenter = new THREE.Mesh(budCenterGeo, budMat);
        const budRing = new THREE.Mesh(budRingGeo, budMat);
        budRing.lookAt(new THREE.Vector3(sx * 2, sy, sz * 2));
        indGroup.add(budCenter);
        indGroup.add(budRing);
        earPivot.add(indGroup);

        closeupFruitTurntable.add(earPivot);

        const earObj = {
          index: idx,
          name: spec.name,
          earPivot,
          collider,
          indicator: indGroup,
          budMat,
          progress: 0, // Starts retracted (0 = tucked/removed, 1 = fully grown & curved)
          isDone: false,
          wobble: 0,
          wobbleVel: 0
        };

        collider.userData.earObj = earObj;
        closeupEars.push(earObj);
        closeupColliderMeshes.push(collider);
      });

    } else {
      // Fallback sculpted fruit (in the unlikely event GLB is not ready yet)
      const bodyGeo = createSculptedFruitBodyGeometry(0.54, 0.74, 36, 28);
      const bodyMat = new THREE.MeshStandardMaterial({
        color: 0x881337,
        map: realDiffuseTexture || proceduralFruitSkin,
        normalMap: realNormalTexture || null
      });
      applyDoDoFruitShader(bodyMat);
      const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
      bodyMesh.castShadow = true;
      bodyMesh.receiveShadow = true;
      bodyMesh.userData.isFruitBody = true;
      closeupFruitTurntable.add(bodyMesh);
      closeupColliderMeshes.push(bodyMesh);

      // Curved natural green stem on top
      const stemCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0.68, 0),
        new THREE.Vector3(0, 1.08, -0.08),
        new THREE.Vector3(-0.18, 1.48, -0.25)
      ]);
      const stemGeo = new THREE.TubeGeometry(stemCurve, 12, 0.14, 3, false);
      const stemMat = new THREE.MeshLambertMaterial({ color: 0x2d8a3e });
      const stemMesh = new THREE.Mesh(stemGeo, stemMat);
      closeupFruitTurntable.add(stemMesh);
    }
  }

  // Dedicated studio lighting attached to closeupGroup for realistic translucent succulent highlights
  const closeupAmbientLight = new THREE.AmbientLight(0xfff7ed, 0.95);
  closeupGroup.add(closeupAmbientLight);

  const closeupKeyLight = new THREE.DirectionalLight(0xfffbeb, 1.0);
  closeupKeyLight.position.set(3.2, 3.8, 3.8);
  closeupGroup.add(closeupKeyLight);

  const closeupFillLight = new THREE.DirectionalLight(0xfef3c7, 0.45);
  closeupFillLight.position.set(-3.5, 0.5, 2.5);
  closeupGroup.add(closeupFillLight);

  const closeupRimLight = new THREE.DirectionalLight(0xf59e0b, 0.65);
  closeupRimLight.position.set(0, 2.0, -4.5);
  closeupGroup.add(closeupRimLight);

  let exitCloseupTimer = 0;
  let exitCloseupTotal = 0.52;
  const exitStartCamPos = new THREE.Vector3();
  const exitStartLookAt = new THREE.Vector3();
  let isExitingCloseup = false;

  function enterCloseupMode(pillar, slot) {
    if (!pillar || !slot) return;
    isExitingCloseup = false;
    exitCloseupTimer = 0;
    state.inCloseup = true;
    state.activePillar = pillar;
    state.activeFruitSlot = slot;
    state.autoWalkTarget = null;
    document.body.classList.add('in-closeup-mode');

    // Hide player character & world fruit slot so NOTHING clips or blocks the close-up camera!
    player.root.visible = false;
    slot.meshGroup.visible = false;

    buildCloseup3DFruit();

    // Place the close-up 3D fruit cleanly at eye level outside the pillar canopy
    const pY = pillar.y !== undefined ? pillar.y : getTerrainHeight(pillar.x, pillar.z);
    const fruitPos = new THREE.Vector3(
      pillar.x + Math.sin(slot.angle) * 2.15,
      pY + 2.15,
      pillar.z + Math.cos(slot.angle) * 2.15
    );
    const camPos = new THREE.Vector3(
      pillar.x + Math.sin(slot.angle) * 4.65,
      pY + 2.18,
      pillar.z + Math.cos(slot.angle) * 4.65
    );

    closeupGroup.position.copy(fruitPos);
    closeupGroup.lookAt(camPos);
    closeupGroup.visible = true;

    const closeupUI = document.getElementById('closeup-ui');
    if (closeupUI) {
      closeupUI.classList.remove('leaving');
      closeupUI.classList.remove('hidden');
    }
    const stampEl = document.getElementById('closeup-stamp');
    const objEl = document.querySelector('.closeup-game-objective');
    if (stampEl) stampEl.classList.add('hidden');
    if (objEl) objEl.classList.remove('hidden');
    document.getElementById('interact-prompt').classList.add('hidden');
    if (window.lucide && window.lucide.createIcons) {
      window.lucide.createIcons();
    }
    updateCloseupProgressUI();
  }

  function exitCloseupMode() {
    if (isExitingCloseup) return;
    if (!state.inCloseup) return;
    isExitingCloseup = true;

    // 1. Play synthesized exit garden breeze / whoosh sound
    if (window.soundManager) {
      if (typeof window.soundManager.playExitGardenWhoosh === 'function') {
        window.soundManager.playExitGardenWhoosh();
      } else if (typeof window.soundManager.playSwipeRustle === 'function') {
        window.soundManager.playSwipeRustle();
      }
    }

    // 2. Trigger lightweight cinematic vignette FX (Zero GPU blur, pure 60FPS)
    const fxEl = document.getElementById('garden-transition-fx');
    if (fxEl) {
      fxEl.classList.remove('active');
      void fxEl.offsetWidth; // trigger reflow
      fxEl.classList.add('active');
      setTimeout(() => fxEl.classList.remove('active'), 340);
    }

    // 3. Smooth UI fade-out
    const closeupUI = document.getElementById('closeup-ui');
    if (closeupUI) {
      closeupUI.classList.add('leaving');
    }

    // 4. Capture current camera position & look target for snappy smooth camera lerp
    exitStartCamPos.copy(camera.position);
    exitStartLookAt.copy(closeupGroup.position);
    exitCloseupTimer = 0.32;
    exitCloseupTotal = 0.32;

    // QUAN TRỌNG: Ẩn ngay lập tức mô hình cận cảnh (closeupGroup) và hiện trái trên trụ (world fruit)!
    // Điều này loại bỏ hoàn toàn hiện tượng trùng 2 trái / dư ảnh (ghosting) khi camera lùi lại!
    closeupGroup.visible = false;
    if (state.activeFruitSlot) {
      state.activeFruitSlot.meshGroup.visible = true;
    }
    player.root.visible = true;

    // Small celebratory sparkle burst at fruit location
    spawn3DSparkles(exitStartLookAt, 10);

    // 5. Complete exit clean-up after transition
    setTimeout(() => {
      document.body.classList.remove('in-closeup-mode');
      state.inCloseup = false;
      state.activePillar = null;
      state.activeFruitSlot = null;
      player.isStrokingAnim = false;
      if (closeupUI) {
        closeupUI.classList.add('hidden');
        closeupUI.classList.remove('leaving');
      }
      const stampEl = document.getElementById('closeup-stamp');
      const objEl = document.querySelector('.closeup-game-objective');
      if (stampEl) stampEl.classList.add('hidden');
      if (objEl) objEl.classList.remove('hidden');
      isExitingCloseup = false;
    }, 320);
  }

  function updateGLBEarMorph(earIdx, p) {
    if (!activeCloseupMeshes || activeCloseupMeshes.length === 0) return;

    activeCloseupMeshes.forEach(mesh => {
      const uData = mesh.geometry.userData;
      if (!uData || !uData.earIndices) return;

      const { origPositions, tuckPositions, earIndices, weights } = uData;
      const pos = mesh.geometry.attributes.position.array;
      const n = earIndices.length;
      let modified = false;

      for (let i = 0; i < n; i++) {
        if (earIndices[i] === earIdx) {
          modified = true;
          const w = weights[i];
          // Graceful organic upward curl flair when stroked towards full maturity
          const liftY = w * Math.sin(p * Math.PI * 0.5) * 0.022;
          const i3 = i * 3;
          pos[i3]     = tuckPositions[i3]     * (1 - p) + origPositions[i3]     * p;
          pos[i3 + 1] = tuckPositions[i3 + 1] * (1 - p) + (origPositions[i3 + 1] + liftY) * p;
          pos[i3 + 2] = tuckPositions[i3 + 2] * (1 - p) + origPositions[i3 + 2] * p;
        }
      }

      if (modified) {
        mesh.geometry.attributes.position.needsUpdate = true;
        mesh.geometry.computeVertexNormals();
      }
    });
  }

  function stroke3DEar(earObj, hitPoint) {
    if (earObj.isDone) return;

    earObj.progress = Math.min(1.0, earObj.progress + 0.35);
    earObj.wobbleVel += (Math.random() - 0.5) * 0.35;

    // Real-time vertex morphing on the authentic 3D GLB model!
    updateGLBEarMorph(earObj.index, earObj.progress);

    if (earObj.geo) {
      updateEarGeometry(earObj);
    }
    if (earObj.budMat) {
      if (earObj.progress >= 1.0) {
        earObj.budMat.color.setHex(0x00e676);
        earObj.budMat.opacity = 0.95;
      } else {
        earObj.budMat.color.setHex(0xffaa00);
        earObj.budMat.opacity = 0.85;
      }
    }

    if (window.soundManager) {
      window.soundManager.playSwipeRustle();
    }

    if (navigator.vibrate) {
      try { navigator.vibrate(18); } catch (_) {}
    }

    const worldPos = hitPoint || (earObj.collider ? earObj.collider.getWorldPosition(new THREE.Vector3()) : new THREE.Vector3());
    spawn3DSparkles(worldPos, 4);

    if (earObj.progress >= 1.0 && !earObj.isDone) {
      earObj.isDone = true;
      earObj.progress = 1.0;

      updateGLBEarMorph(earObj.index, 1.0);

      if (earObj.geo) {
        updateEarGeometry(earObj);
      }
      if (earObj.indicator) {
        earObj.indicator.visible = false;
      }

      spawn3DSparkles(worldPos, 16);

      if (window.soundManager) {
        const doneCount = closeupEars.filter(e => e.isDone).length;
        window.soundManager.playEarStraighten(doneCount);
      }

      updateCloseupProgressUI();

      if (closeupEars.every(e => e.isDone)) {
        completeCloseupFruit();
      }
    }
  }

  function updateCloseupProgressUI() {
    const done = closeupEars.filter(e => e.isDone).length;
    const total = closeupEars.length || 12;
    const countEl = document.getElementById('closeup-ear-count');
    if (countEl) countEl.textContent = `${done}/${total}`;

    const fillEl = document.getElementById('closeup-progress-fill');
    if (fillEl) fillEl.style.width = `${Math.round((done / total) * 100)}%`;

    // Update luxury segmented progress track
    const segs = document.querySelectorAll('.ear-segment');
    segs.forEach((seg, idx) => {
      if (idx < done) {
        seg.classList.add('active');
      } else {
        seg.classList.remove('active');
      }
    });
  }

  function completeCloseupFruit() {
    if (window.soundManager) {
      window.soundManager.playStampSound();
      window.soundManager.playVictoryFanfare();
      window.soundManager.playCoin();
    }

    const stampEl = document.getElementById('closeup-stamp');
    if (stampEl) stampEl.classList.remove('hidden');

    if (state.activeFruitSlot) {
      markWorldFruitAsStroked(state.activeFruitSlot);
    }
    if (state.activePillar && state.activePillar.remainingCount === 0) {
      state.activePillar.auraRing.material.color.setHex(0x00e676);
      state.activePillar.auraRing.material.opacity = 0.25;
    }

    state.money += 25000;
    state.fruitsStroked += 1;
    safeSetStorage('vt3d_money', state.money.toString());
    safeSetStorage('vt3d_fruits', state.fruitsStroked.toString());
    player.updateScore(state.fruitsStroked);
    updateHUD();

    broadcastPlayerState();

    setTimeout(() => {
      if (!state.inCloseup) return;
      const nextSlot = state.activePillar ? state.activePillar.fruitSlots.find(s => !s.stroked) : null;
      if (nextSlot) {
        state.activeFruitSlot.meshGroup.visible = true;
        enterCloseupMode(state.activePillar, nextSlot);
      } else {
        exitCloseupMode();
      }
    }, 1150);
  }

  function spawn3DSparkles(pos, count) {
    const geo = new THREE.OctahedronGeometry(0.045, 0);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? 0x00e676 : 0xffca28,
        transparent: true,
        opacity: 1
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.copy(pos);
      scene.add(mesh);

      closeupParticles.push({
        mesh,
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * 1.8,
          0.6 + Math.random() * 1.4,
          (Math.random() - 0.5) * 1.8
        ),
        life: 1.0
      });
    }
  }

  let indicatorPulseTime = 0;

  function updateCloseupFruitAndParticles(dt) {
    if (state.inCloseup) {
      // Rotate turntable if user holds A/D or rotate buttons
      if (moveInput.left || onScreenMove.left || rotateBtnDir === -1) {
        state.fruitSpinY -= dt * 2.8;
      }
      if (moveInput.right || onScreenMove.right || rotateBtnDir === 1) {
        state.fruitSpinY += dt * 2.8;
      }
      closeupFruitTurntable.rotation.y = state.fruitSpinY;

      indicatorPulseTime += dt * 4;
      const pulse = 1.0 + Math.sin(indicatorPulseTime) * 0.15;

      closeupEars.forEach((ear) => {
        if (ear.indicator && !ear.isDone) {
          ear.indicator.rotation.y += dt * 1.5;
          ear.indicator.rotation.z += dt * 1.2;
          ear.indicator.scale.setScalar(pulse * (1.0 + ear.progress * 0.3));
        }

        if (ear.geo && (Math.abs(ear.wobble) > 0.001 || Math.abs(ear.wobbleVel) > 0.001)) {
          ear.wobble += ear.wobbleVel;
          ear.wobbleVel -= ear.wobble * 0.28;
          ear.wobbleVel *= 0.8;
          updateEarGeometry(ear);
        }
      });
    }

    for (let i = closeupParticles.length - 1; i >= 0; i--) {
      const p = closeupParticles[i];
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.rotation.x += dt * 5;
      p.mesh.rotation.y += dt * 5;
      p.life -= dt * 1.9;
      p.mesh.material.opacity = Math.max(0, p.life);
      if (p.life <= 0) {
        scene.remove(p.mesh);
        closeupParticles.splice(i, 1);
      }
    }
  }

  function handleCloseupPointer(clientX, clientY) {
    if (!state.inCloseup) return;
    pointerNDC.x = (clientX / window.innerWidth) * 2 - 1;
    pointerNDC.y = -(clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(pointerNDC, camera);
    const hits = raycaster.intersectObjects(closeupColliderMeshes, true);
    if (hits.length > 0) {
      let hitEar = null;
      for (const h of hits) {
        if (h.object.userData && h.object.userData.earObj) {
          hitEar = h.object.userData.earObj;
          break;
        }
      }

      // If user swiped across the 3D fruit body, find the nearest unstroked ear
      if (!hitEar && hits[0].point) {
        let minDist = Infinity;
        for (const ear of closeupEars) {
          if (!ear.isDone) {
            const anchorTarget = ear.anchor || ear.earPivot || ear.collider;
            const anchorPos = anchorTarget.getWorldPosition(new THREE.Vector3());
            const d = anchorPos.distanceTo(hits[0].point);
            if (d < minDist) {
              minDist = d;
              hitEar = ear;
            }
          }
        }
        if (minDist > 0.85) hitEar = null;
      }

      if (hitEar && !hitEar.isDone) {
        stroke3DEar(hitEar, hits[0].point);
        return true;
      }
    }
    return false;
  }

  // Rotate left/right UI buttons in Close-up mode
  let rotateBtnDir = 0;
  const rotLeftBtn = document.getElementById('rotate-left-btn');
  const rotRightBtn = document.getElementById('rotate-right-btn');
  if (rotLeftBtn && rotRightBtn) {
    const bindRotBtn = (btn, dir) => {
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        try { btn.setPointerCapture(e.pointerId); } catch (err) {}
        rotateBtnDir = dir;
      });
      btn.addEventListener('pointerup', (e) => {
        try { btn.releasePointerCapture(e.pointerId); } catch (err) {}
        rotateBtnDir = 0;
      });
      btn.addEventListener('pointercancel', () => (rotateBtnDir = 0));
      btn.addEventListener('pointerleave', (e) => {
        if (!btn.hasPointerCapture || !btn.hasPointerCapture(e.pointerId)) {
          rotateBtnDir = 0;
        }
      });
    };
    bindRotBtn(rotLeftBtn, -1);
    bindRotBtn(rotRightBtn, 1);
  }

  // ==========================================
  // 8. SMOOTH 3RD-PERSON CAMERA & MOVEMENT
  // ==========================================
  const keys = {};
  let camYaw = 0;        // 0 means camera is at +Z looking toward -Z (into the orchard)
  let camPitch = 0.34;   // Comfortable elevated angle
  let camZoomOffset = 0; // Mouse wheel zoom adjustment
  let isDraggingCam = false;
  let pointerDownPos = { x: 0, y: 0 };
  let prevPointer = { x: 0, y: 0 };
  let joyVec = { x: 0, y: 0 };
  let nearestPillar = null;

  // Rock-Solid Movement Inputs State
  const moveInput = {
    forward: false,
    backward: false,
    left: false,
    right: false,
    sprint: false
  };

  // On-Screen D-Pad Movement Controller State
  const onScreenMove = {
    up: false,
    down: false,
    left: false,
    right: false,
    sprint: false
  };

  // Physical key state set (fail-safe tracking for WASD & Arrows)
  const activeKeys = new Set();

  function updateMoveInputFromActiveKeys() {
    moveInput.forward = activeKeys.has('KeyW') || activeKeys.has('ArrowUp');
    moveInput.backward = activeKeys.has('KeyS') || activeKeys.has('ArrowDown');
    moveInput.left = activeKeys.has('KeyA') || activeKeys.has('ArrowLeft');
    moveInput.right = activeKeys.has('KeyD') || activeKeys.has('ArrowRight');
    moveInput.sprint = activeKeys.has('ShiftLeft') || activeKeys.has('ShiftRight');
  }

  function isTypingInInput() {
    const active = document.activeElement;
    return active === document.getElementById('chat-input') ||
           active === document.getElementById('player-name-input') ||
           (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA'));
  }

  function resolveMovementKey(e) {
    const c = e.code || '';
    const k = (e.key || '').toLowerCase();
    const kc = e.keyCode;

    if (c === 'KeyW' || c === 'ArrowUp' || k === 'w' || k === 'ư' || kc === 87 || kc === 38) return 'KeyW';
    if (c === 'KeyS' || c === 'ArrowDown' || k === 's' || kc === 83 || kc === 40) return 'KeyS';
    if (c === 'KeyA' || c === 'ArrowLeft' || k === 'a' || k === 'à' || k === 'á' || kc === 65 || kc === 37) return 'KeyA';
    if (c === 'KeyD' || c === 'ArrowRight' || k === 'd' || k === 'đ' || kc === 68 || kc === 39) return 'KeyD';
    if (c === 'ShiftLeft' || c === 'ShiftRight' || k === 'shift' || kc === 16) return 'ShiftLeft';
    return null;
  }

  function releaseAllMovement() {
    activeKeys.clear();
    updateMoveInputFromActiveKeys();
    moveInput.forward = false;
    moveInput.backward = false;
    moveInput.left = false;
    moveInput.right = false;
    moveInput.sprint = false;
    for (const k in keys) keys[k] = false;

    onScreenMove.up = false;
    onScreenMove.down = false;
    onScreenMove.left = false;
    onScreenMove.right = false;
    onScreenMove.sprint = false;

    joyVec.x = 0;
    joyVec.y = 0;
    rotateBtnDir = 0;
    state.autoWalkTarget = null;

    document.querySelectorAll('.dpad-btn').forEach(b => b.classList.remove('active'));
  }

  // Setup D-Pad buttons with pointer capture & fail-safe release
  function setupDpadButton(btnId, moveKey) {
    const btn = document.getElementById(btnId);
    if (!btn) return;

    btn.setAttribute('tabindex', '-1');

    const onPress = (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { btn.setPointerCapture(e.pointerId); } catch (_) {}
      onScreenMove[moveKey] = true;
      btn.classList.add('active');
    };

    const onRelease = (e) => {
      e.stopPropagation();
      try { btn.releasePointerCapture(e.pointerId); } catch (_) {}
      onScreenMove[moveKey] = false;
      btn.classList.remove('active');
    };

    btn.addEventListener('pointerdown', onPress);
    btn.addEventListener('pointerup', onRelease);
    btn.addEventListener('pointerleave', onRelease);
    btn.addEventListener('pointercancel', onRelease);
    btn.addEventListener('blur', onRelease);
    btn.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setupDpadButton('dpad-up', 'up');
  setupDpadButton('dpad-down', 'down');
  setupDpadButton('dpad-left', 'left');
  setupDpadButton('dpad-right', 'right');
  setupDpadButton('dpad-sprint', 'sprint');

  // Comprehensive Keydown: handles standard keys, arrow keys, and Vietnamese Telex/VNI IME
  window.addEventListener('keydown', (e) => {
    if (isTypingInInput()) return;

    if (e.key === 'Enter' && state.joined && !state.inCloseup) {
      const ci = document.getElementById('chat-input');
      if (ci) {
        ci.focus();
        e.preventDefault();
      }
      return;
    }

    const moveKey = resolveMovementKey(e);
    if (moveKey) {
      activeKeys.add(moveKey);
      updateMoveInputFromActiveKeys();
      state.autoWalkTarget = null;
      e.preventDefault();
      return;
    }

    const c = e.code || '';
    const k = (e.key || '').toLowerCase();
    if ((c === 'KeyE' || k === 'e' || c === 'Space' || k === ' ') && state.joined && !state.inCloseup) {
      tryInteractWithNearestPillar();
    } else if ((c === 'KeyH' || k === 'h') && state.joined && !state.inCloseup) {
      toggleControlsGuide();
      e.preventDefault();
    } else if (c === 'Escape' && state.inCloseup) {
      exitCloseupMode();
    }
  });

  // Comprehensive Keyup: instantly releases movement & handles Vietnamese Unikey/EVKey Telex
  window.addEventListener('keyup', (e) => {
    const moveKey = resolveMovementKey(e);
    if (moveKey) {
      activeKeys.delete(moveKey);
      updateMoveInputFromActiveKeys();
    } else if (e.keyCode === 229 || (e.key && e.key.toLowerCase() === 'process') || !e.code || e.code === 'Unidentified') {
      // Vietnamese Unikey/EVKey Telex interception safety: release all keys so character never walks forever!
      activeKeys.clear();
      updateMoveInputFromActiveKeys();
    }
  });

  // Bulletproof safety: release all keys on blur, tab hide, right-click, window pointerup/pointercancel
  window.addEventListener('blur', releaseAllMovement);
  window.addEventListener('contextmenu', releaseAllMovement);
  window.addEventListener('pointercancel', releaseAllMovement);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseAllMovement();
  });

  // Mouse Wheel Zoom (Desktop)
  window.addEventListener('wheel', (e) => {
    if (!state.joined || state.inCloseup) return;
    camZoomOffset = Math.max(-3.0, Math.min(8.0, camZoomOffset + e.deltaY * 0.005));
  }, { passive: true });

  // ==========================================
  // MOBILE DUAL-FINGER PINCH-TO-ZOOM CONTROLLER
  // Nhận diện cử chỉ 2 ngón chụm / mở ở bất kỳ đâu trên màn hình di động (Global Capture Phase)
  // ==========================================
  let touchPinchStartDist = null;
  let touchPinchStartZoom = 0;
  let isPinching = false;

  window.addEventListener('touchstart', (e) => {
    if (!state.joined || state.inCloseup) return;
    if (e.touches && e.touches.length >= 2) {
      isPinching = true;
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      touchPinchStartDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      touchPinchStartZoom = camZoomOffset;

      // Hủy trạng thái joystick và xoay camera đơn điểm khi đang dùng 2 ngón pinch
      isDraggingCam = false;
      camPointerId = null;
      activeCameraTouches.clear();
      if (joyActive) {
        joyActive = false;
        joyPointerId = null;
        joyVec.x = 0;
        joyVec.y = 0;
        onScreenMove.sprint = false;
        if (joyStick) joyStick.style.transform = 'translate(0px, 0px)';
        if (joyBase) joyBase.classList.remove('active');
      }
      e.preventDefault();
    }
  }, { capture: true, passive: false });

  window.addEventListener('touchmove', (e) => {
    if (!state.joined || state.inCloseup) return;
    if (e.touches && e.touches.length >= 2 && touchPinchStartDist !== null) {
      isPinching = true;
      const t1 = e.touches[0];
      const t2 = e.touches[1];
      const curDist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      const delta = touchPinchStartDist - curDist;
      // Chụm 2 ngón lại gần nhau (delta > 0) -> Zoom xa ra; Mở rộng 2 ngón (delta < 0) -> Zoom lại gần
      camZoomOffset = Math.max(-3.0, Math.min(8.0, touchPinchStartZoom + delta * 0.03));
      e.preventDefault();
    }
  }, { capture: true, passive: false });

  const onPinchTouchEnd = (e) => {
    if (!e.touches || e.touches.length < 2) {
      touchPinchStartDist = null;
      setTimeout(() => { isPinching = false; }, 90);
    }
  };

  window.addEventListener('touchend', onPinchTouchEnd, { capture: true, passive: true });
  window.addEventListener('touchcancel', onPinchTouchEnd, { capture: true, passive: true });

  // Mobile & Desktop Camera Controller (Full 360-degree Orbit)
  let camPointerId = null;
  const activeCameraTouches = new Map();
  let pinchInitialDist = null;
  let pinchInitialZoom = 0;

  function startCamDrag(clientX, clientY, pointerId, pointerType) {
    if (!state.joined || isPinching) return;

    if (state.inCloseup) {
      pointerDownPos.x = clientX;
      pointerDownPos.y = clientY;
      prevPointer.x = clientX;
      prevPointer.y = clientY;
      return;
    }

    if (pointerType === 'touch') {
      activeCameraTouches.set(pointerId, { x: clientX, y: clientY });
      if (activeCameraTouches.size >= 2) {
        const pts = Array.from(activeCameraTouches.values());
        pinchInitialDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        pinchInitialZoom = camZoomOffset;
        return;
      }
    }

    if (camPointerId === null) {
      camPointerId = pointerId;
      isDraggingCam = true;
      pointerDownPos.x = clientX;
      pointerDownPos.y = clientY;
      prevPointer.x = clientX;
      prevPointer.y = clientY;
    }
  }

  function moveCamDrag(clientX, clientY, pointerId) {
    if (isPinching) return;
    if (state.inCloseup) {
      if (isRotatingCloseupFruit) {
        const dx = clientX - prevPointer.x;
        prevPointer.x = clientX;
        state.fruitSpinY += dx * 0.012;
      } else if (isSwipingCloseup) {
        const stroked = handleCloseupPointer(clientX, clientY);
        const dx = clientX - prevPointer.x;
        if (!stroked && Math.abs(dx) > 1.2) {
          state.fruitSpinY += dx * 0.009;
        }
        prevPointer.x = clientX;
      }
      return;
    }

    if (activeCameraTouches.has(pointerId)) {
      activeCameraTouches.set(pointerId, { x: clientX, y: clientY });
    }

    // Hai ngón tay chụm / mở để phóng to thu nhỏ (Pinch-to-zoom) trên màn hình cảm ứng
    if (activeCameraTouches.size >= 2 && pinchInitialDist) {
      const pts = Array.from(activeCameraTouches.values());
      const curDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const zoomDiff = (pinchInitialDist - curDist) * 0.02;
      camZoomOffset = Math.max(-3.0, Math.min(8.0, pinchInitialZoom + zoomDiff));
      return;
    }

    if (isDraggingCam && pointerId === camPointerId) {
      const dx = clientX - prevPointer.x;
      const dy = clientY - prevPointer.y;
      prevPointer.x = clientX;
      prevPointer.y = clientY;

      // Xoay 360 độ toàn cảnh theo chiều ngang và điều chỉnh góc nhìn cao thấp mượt mà
      camYaw -= dx * 0.0075;
      camPitch = Math.max(0.12, Math.min(1.10, camPitch + dy * 0.0052));
    }
  }

  function endCamDrag(pointerId, clientX, clientY) {
    activeCameraTouches.delete(pointerId);
    if (activeCameraTouches.size < 2) {
      pinchInitialDist = null;
    }

    if (pointerId === camPointerId) {
      if (!state.inCloseup && state.joined && isDraggingCam && clientX !== undefined && clientY !== undefined) {
        const dragDist = Math.hypot(clientX - pointerDownPos.x, clientY - pointerDownPos.y);
        if (dragDist < 8) {
          handleWorldClick(clientX, clientY);
        }
      }
      isDraggingCam = false;
      camPointerId = null;

      // Nếu còn ngón tay khác đang chạm trong vùng camera, chuyển quyền điều khiển mượt mà sang ngón đó
      if (activeCameraTouches.size > 0) {
        const [nextId, nextPos] = activeCameraTouches.entries().next().value;
        camPointerId = nextId;
        isDraggingCam = true;
        pointerDownPos.x = nextPos.x;
        pointerDownPos.y = nextPos.y;
        prevPointer.x = nextPos.x;
        prevPointer.y = nextPos.y;
      }
    }

    if (state.inCloseup) {
      isSwipingCloseup = false;
      isRotatingCloseupFruit = false;
    }
  }

  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (window.soundManager) {
      window.soundManager.resume();
      window.soundManager.startBGM();
    }
    if (state.inCloseup) {
      if (e.button === 2) {
        isRotatingCloseupFruit = true;
      } else {
        isSwipingCloseup = true;
        handleCloseupPointer(e.clientX, e.clientY);
      }
      startCamDrag(e.clientX, e.clientY, e.pointerId, e.pointerType);
      return;
    }
    startCamDrag(e.clientX, e.clientY, e.pointerId, e.pointerType);
  });

  // Dedicated Mobile Camera Touch Zone (Nửa phải màn hình - Vuốt xoay 360 độ độc lập với joystick)
  const camZone = document.getElementById('camera-touch-zone');
  if (camZone) {
    camZone.addEventListener('pointerdown', (e) => {
      if (!state.joined || state.inCloseup || isPinching) return;

      // Không chặn sự kiện nếu chạm vào các nút HUD, popup, chat, radar
      if (e.target.closest('button, a, input, select, textarea, .interact-prompt, .controls-hud, .guide-reopen-pill, .game-chat-hud, .hud-top, .dpad-container, .closeup-hotkey-dock, .hud-tool-btn, .modal-overlay, .welcome-screen, .dialog-box, .mobile-chat-bubble, .game-radar-wrap, .chat-panel')) {
        return;
      }

      e.stopPropagation();
      try { camZone.setPointerCapture(e.pointerId); } catch (_) {}

      if (window.soundManager) {
        window.soundManager.resume();
        window.soundManager.startBGM();
      }
      startCamDrag(e.clientX, e.clientY, e.pointerId, e.pointerType);
    });

    camZone.addEventListener('pointermove', (e) => {
      if (isPinching) return;
      moveCamDrag(e.clientX, e.clientY, e.pointerId);
    });

    const onCamZoneEnd = (e) => {
      try { camZone.releasePointerCapture(e.pointerId); } catch (_) {}
      endCamDrag(e.pointerId, e.clientX, e.clientY);
    };

    camZone.addEventListener('pointerup', onCamZoneEnd);
    camZone.addEventListener('pointercancel', onCamZoneEnd);
  }

  window.addEventListener('pointermove', (e) => {
    moveCamDrag(e.clientX, e.clientY, e.pointerId);
  });

  window.addEventListener('pointerup', (e) => {
    if (!joyActive) {
      onScreenMove.up = false;
      onScreenMove.down = false;
      onScreenMove.left = false;
      onScreenMove.right = false;
      onScreenMove.sprint = false;
      rotateBtnDir = 0;
      document.querySelectorAll('.dpad-btn').forEach(b => b.classList.remove('active'));
    }
    endCamDrag(e.pointerId, e.clientX, e.clientY);
  });

  window.addEventListener('pointercancel', (e) => {
    endCamDrag(e.pointerId, e.clientX, e.clientY);
  });

  function handleWorldClick(clientX, clientY) {
    pointerNDC.x = (clientX / window.innerWidth) * 2 - 1;
    pointerNDC.y = -(clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointerNDC, camera);

    const pillarPosts = pillars.map(p => p.post);
    const hits = raycaster.intersectObjects(pillarPosts, false);
    if (hits.length > 0) {
      const clickedPillar = hits[0].object.userData.pillarObj;
      if (clickedPillar && clickedPillar.remainingCount > 0) {
        const dist = Math.hypot(player.root.position.x - clickedPillar.x, player.root.position.z - clickedPillar.z);
        if (dist < 4.8) {
          const slot = clickedPillar.fruitSlots.find(s => !s.stroked);
          if (slot) enterCloseupMode(clickedPillar, slot);
        } else {
          showToast('👉 Hãy đi lại gần trụ thanh long để vuốt ngoe nhé!');
        }
      }
    }
  }

  // ==========================================
  // MOBILE DYNAMIC VIRTUAL JOYSTICK (Kiểu Liên Quân Mobile)
  // Chạm đâu hiện cần gạt ở đó, vuốt để di chuyển, nhấc tay tự động ẩn hoàn toàn
  // ==========================================
  const joyZone = document.getElementById('joystick-zone');
  const joyBase = document.getElementById('joystick-base');
  const joyStick = document.getElementById('joystick-stick');
  let joyActive = false;
  let joyPointerId = null;
  let joyOrigin = { x: 0, y: 0 };
  const JOY_MAX_R = 52; // Bán kính di chuyển tối đa của cần gạt

  if (joyZone && joyBase && joyStick) {
    joyZone.addEventListener('pointerdown', (e) => {
      if (!state.joined || state.inCloseup || isPinching) return;

      // Tuyệt đối không kích hoạt cần gạt nếu người dùng chạm/click vào bất kỳ nút bấm hoặc HUD nào!
      if (e.target.closest('button, a, input, select, textarea, .interact-prompt, .controls-hud, .guide-reopen-pill, .game-chat-hud, .mobile-chat-pill, .chat-panel, .hud-top, .dpad-container, .closeup-hotkey-dock, .hud-tool-btn, .modal-overlay, .welcome-screen, .dialog-box, .mobile-chat-bubble, .game-radar-wrap')) {
        return;
      }

      // Trên Desktop (> 860px) nếu dùng chuột (mouse), không kích hoạt joystick để chuột tự do xoay camera
      if (window.innerWidth > 860 && e.pointerType === 'mouse') return;

      e.stopPropagation();
      try { joyZone.setPointerCapture(e.pointerId); } catch (_) {}

      joyActive = true;
      joyPointerId = e.pointerId;

      // Đặt tâm Joystick ngay tại vị trí ngón tay chạm xuống (chuẩn Liên Quân)
      joyOrigin.x = e.clientX;
      joyOrigin.y = e.clientY;
      joyBase.style.left = `${joyOrigin.x}px`;
      joyBase.style.top = `${joyOrigin.y}px`;
      joyBase.classList.add('active');
      joyStick.style.transform = `translate(0px, 0px)`;
      joyVec.x = 0;
      joyVec.y = 0;

      if (window.soundManager) {
        window.soundManager.resume();
        window.soundManager.startBGM();
      }
    });

    const onJoyMove = (e) => {
      if (isPinching || !joyActive || e.pointerId !== joyPointerId) return;
      e.stopPropagation();
      let dx = e.clientX - joyOrigin.x;
      let dy = e.clientY - joyOrigin.y;
      const dist = Math.hypot(dx, dy);

      if (dist > JOY_MAX_R) {
        dx = (dx / dist) * JOY_MAX_R;
        dy = (dy / dist) * JOY_MAX_R;
      }

      joyStick.style.transform = `translate(${dx}px, ${dy}px)`;
      joyVec.x = dx / JOY_MAX_R;
      joyVec.y = dy / JOY_MAX_R;

      // Khi đẩy cần gạt ra xa hơn 82% bán kính, tự động kích hoạt Chạy nhanh (Sprint)
      onScreenMove.sprint = dist > (JOY_MAX_R * 0.82);
    };

    const onJoyEnd = (e) => {
      if (e && joyPointerId !== null && e.pointerId !== joyPointerId) return;
      joyActive = false;
      joyPointerId = null;
      joyVec.x = 0;
      joyVec.y = 0;
      onScreenMove.sprint = false;
      joyStick.style.transform = `translate(0px, 0px)`;
      joyBase.classList.remove('active'); // Tự động ẩn cần gạt khi nhấc tay!
    };

    joyZone.addEventListener('pointermove', onJoyMove);
    joyZone.addEventListener('pointerup', onJoyEnd);
    joyZone.addEventListener('pointercancel', onJoyEnd);
    window.addEventListener('pointerup', onJoyEnd);
    window.addEventListener('pointercancel', onJoyEnd);
  }

  // Cinematic Camera Entrance Swoop State
  let isEnteringWorld = false;
  let enterIntroTimer = 0;
  const enterIntroTotal = 1.35;
  const introStartCamPos = new THREE.Vector3(0, 11.5, 54);

  function updatePlayerAndCamera(dt) {
    if (state.inCloseup && !isExitingCloseup && state.activePillar && state.activeFruitSlot) {
      // Position camera at a clean, comfortable distance (3.2m away from the close-up fruit)
      const slot = state.activeFruitSlot;
      const p = state.activePillar;
      const pY = p.y !== undefined ? p.y : getTerrainHeight(p.x, p.z);
      const targetCamPos = new THREE.Vector3(
        p.x + Math.sin(slot.angle) * 5.35,
        pY + 2.22,
        p.z + Math.cos(slot.angle) * 5.35
      );
      camera.position.lerp(targetCamPos, 0.18);
      camera.lookAt(closeupGroup.position);
      return;
    }

    let moveForward = 0;
    let moveRight = 0;

    if (moveInput.forward || onScreenMove.up) moveForward += 1;
    if (moveInput.backward || onScreenMove.down) moveForward -= 1;
    if (moveInput.right || onScreenMove.right) moveRight += 1;
    if (moveInput.left || onScreenMove.left) moveRight -= 1;

    if (Math.abs(joyVec.x) > 0.05 || Math.abs(joyVec.y) > 0.05) {
      moveForward = -joyVec.y;
      moveRight = joyVec.x;
    }

    const isMoving = Math.abs(moveForward) > 0.01 || Math.abs(moveRight) > 0.01;
    const isSprinting = moveInput.sprint || onScreenMove.sprint;
    const speed = isSprinting ? 11.5 : 7.2;

    if (isMoving) {
      const forwardDir = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
      const rightDir = new THREE.Vector3(Math.cos(camYaw), 0, -Math.sin(camYaw));

      const moveDir = new THREE.Vector3()
        .addScaledVector(forwardDir, moveForward)
        .addScaledVector(rightDir, moveRight)
        .normalize();

      const targetX = player.root.position.x + moveDir.x * speed * dt;
      const targetZ = player.root.position.z + moveDir.z * speed * dt;

      const clampedX = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, targetX));
      const clampedZ = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, targetZ));

      let newX = clampedX;
      let newZ = clampedZ;

      // 1. Scenic River & Arched Moon Bridge Physics
      const curDx = player.root.position.x - (-54);
      const nextDx = newX - (-54);
      const onBridgeNow = Math.abs(player.root.position.z) <= 1.25 && Math.abs(curDx) <= 3.6;
      const enteringFromBridgeEnds = Math.abs(curDx) >= 3.2 && Math.abs(nextDx) <= 3.6 && Math.abs(newZ) <= 1.25;

      if (onBridgeNow || enteringFromBridgeEnds) {
        // Player is walking across the bridge deck: wooden handrails safely bound Z to [-1.15, 1.15]
        newZ = Math.max(-1.15, Math.min(1.15, newZ));
      } else {
        // Player is on the riverbank: steep banks and handrails prevent wading into deep water or under the bridge
        const riverCenter = -54 + Math.sin(newZ * 0.05) * 5.2;
        const riverDist = Math.abs(newX - riverCenter);
        if (riverDist < 4.0) {
          if (player.root.position.x >= riverCenter) {
            newX = Math.max(newX, riverCenter + 4.0);
          } else {
            newX = Math.min(newX, riverCenter - 4.0);
          }
        }
      }

      // 2. Dragon Fruit Pillars Collision (Continuous circle-to-circle smooth sliding)
      // Radius 2.15m prevents penetrating into the raised earthen mound, concrete post and vine trunks
      // while leaving ample comfortable room for fruit interaction (up to 4.8m)
      const PILLAR_COLLIDE_R = 2.15;
      for (let iter = 0; iter < 2; iter++) {
        for (const pil of pillars) {
          const dx = newX - pil.x;
          const dz = newZ - pil.z;
          const dist = Math.hypot(dx, dz);
          if (dist < PILLAR_COLLIDE_R && dist > 0.0001) {
            const overlap = PILLAR_COLLIDE_R - dist;
            newX += (dx / dist) * overlap;
            newZ += (dz / dist) * overlap;
          }
        }
      }

      // 3. World Rocks & Natural Landscape Obstacles Collision (Riverbank stones, landscape boulders, trees)
      for (const rk of rockColliders) {
        const dx = newX - rk.x;
        const dz = newZ - rk.z;
        const dist = Math.hypot(dx, dz);
        const minDist = rk.r + 0.35;
        if (dist < minDist && dist > 0.0001) {
          const overlap = minDist - dist;
          newX += (dx / dist) * overlap;
          newZ += (dz / dist) * overlap;
        }
      }

      // 4. Entrance Gate Columns Collision at z = 58
      [-5.6, 5.6].forEach(gx => {
        const dx = newX - gx;
        const dz = newZ - 58;
        const dist = Math.hypot(dx, dz);
        if (dist < 1.15 && dist > 0.0001) {
          const overlap = 1.15 - dist;
          newX += (dx / dist) * overlap;
          newZ += (dz / dist) * overlap;
        }
      });

      player.root.position.x = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, newX));
      player.root.position.z = Math.max(-WORLD_LIMIT, Math.min(WORLD_LIMIT, newZ));

      player.root.rotation.y = Math.atan2(moveDir.x, moveDir.z);
    }

    // Adapt player height Y to walking surface (bridge deck or terrain) smoothly
    const targetY = getWalkSurfaceHeight(player.root.position.x, player.root.position.z);
    player.root.position.y += (targetY - player.root.position.y) * Math.min(1.0, dt * 20);

    player.animate(dt, isMoving, isSprinting);

    // Synchronous rock-solid 3rd-person follow camera (Zero lag / Zero jitter!)
    const distPresets = [7.6, 15.0, 5.0];
    const camDist = Math.max(3.8, distPresets[state.cameraMode] + camZoomOffset);

    // Điều chỉnh vị trí nhân vật xuống 1/3 dưới màn hình (đặc biệt trên Mobile dọc) để tầm nhìn thoáng đẹp
    const isPortrait = window.innerHeight > window.innerWidth;
    const vOffsetFactor = isPortrait ? 0.145 : 0.075;
    const camVOffset = camDist * vOffsetFactor;

    const camHeight = Math.sin(camPitch) * camDist + 1.75 + camVOffset;
    const horizDist = Math.cos(camPitch) * camDist;

    const desiredCamPos = new THREE.Vector3(
      player.root.position.x + Math.sin(camYaw) * horizDist,
      player.root.position.y + camHeight,
      player.root.position.z + Math.cos(camYaw) * horizDist
    );

    const lookTargetY = player.root.position.y + 1.25 + camVOffset;

    if (enterIntroTimer > 0) {
      enterIntroTimer = Math.max(0, enterIntroTimer - dt);
      const p = 1 - (enterIntroTimer / enterIntroTotal);
      // Cinematic cubic ease-out
      const ease = 1 - Math.pow(1 - p, 3);
      camera.position.lerpVectors(introStartCamPos, desiredCamPos, ease);
      camera.lookAt(
        player.root.position.x,
        lookTargetY + (1 - ease) * 1.8,
        player.root.position.z
      );
    } else if (exitCloseupTimer > 0) {
      exitCloseupTimer = Math.max(0, exitCloseupTimer - dt);
      const p = 1 - (exitCloseupTimer / exitCloseupTotal);
      // Snappy quad ease-out: ultra-smooth & responsive without lag
      const ease = p * (2 - p);
      camera.position.lerpVectors(exitStartCamPos, desiredCamPos, ease);
      const targetLookAt = new THREE.Vector3(
        player.root.position.x,
        lookTargetY,
        player.root.position.z
      );
      const curLookAt = new THREE.Vector3().lerpVectors(exitStartLookAt, targetLookAt, ease);
      camera.lookAt(curLookAt);
    } else {
      camera.position.copy(desiredCamPos);
      camera.lookAt(
        player.root.position.x,
        lookTargetY,
        player.root.position.z
      );
    }

    checkNearestPillar();
  }

  function checkNearestPillar() {
    let bestPillar = null;
    let bestDist = 4.6;

    for (const pil of pillars) {
      if (pil.remainingCount === 0) continue;
      const d = Math.hypot(player.root.position.x - pil.x, player.root.position.z - pil.z);
      if (d < bestDist) {
        bestDist = d;
        bestPillar = pil;
      }
    }

    nearestPillar = bestPillar;
    const promptEl = document.getElementById('interact-prompt');
    if (nearestPillar && state.joined && !state.inCloseup) {
      document.getElementById('prompt-fruit-count').textContent = nearestPillar.remainingCount;
      promptEl.classList.remove('hidden');
    } else {
      promptEl.classList.add('hidden');
    }
  }

  function tryInteractWithNearestPillar() {
    if (!nearestPillar) {
      showToast('Hãy đi lại gần một trụ thanh long có vòng sáng hồng (hoặc click vào trụ) để vuốt ngoe nhé!');
      return;
    }
    const slot = nearestPillar.fruitSlots.find(s => !s.stroked);
    if (slot) {
      enterCloseupMode(nearestPillar, slot);
    }
  }

  const promptEl = document.getElementById('interact-prompt');
  if (promptEl) {
    const handleInteractClick = (e) => {
      e.stopPropagation();
      e.preventDefault();
      tryInteractWithNearestPillar();
    };
    promptEl.addEventListener('pointerdown', (e) => e.stopPropagation());
    promptEl.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: false });
    promptEl.addEventListener('click', handleInteractClick);
  }

  const exitCloseupBtn = document.getElementById('exit-closeup-btn');
  if (exitCloseupBtn) {
    exitCloseupBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exitCloseupMode();
    });
  }

  const topBackBtn = document.getElementById('closeup-top-back-btn');
  if (topBackBtn) {
    topBackBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      exitCloseupMode();
    });
  }

  document.getElementById('quick-spray-btn').addEventListener('click', () => {
    if (!state.inCloseup) return;
    const undone = closeupEars.filter(e => !e.isDone);
    undone.slice(0, 4).forEach(ear => {
      ear.progress = 0.85;
      stroke3DEar(ear);
    });
  });

  // ==========================================
  // 9. 3D TO 2D HTML LABELS & MINIMAP (GPU ACCELERATED TRANSLATE3D)
  // ==========================================
  const tempProjVec = new THREE.Vector3();

  function updateFloatingLabels() {
    if (state.inCloseup) {
      player.labelEl.style.opacity = '0';
      npcFarmers.forEach(n => (n.avatar.labelEl.style.opacity = '0'));
      return;
    }

    // Hide self nametag so it never wobbles in front of your own nose (only chat bubbles appear)
    player.labelEl.style.opacity = player.chatBubbleEl.classList.contains('hidden') ? '0' : '1';
    if (player.labelEl.style.opacity === '1') {
      tempProjVec.copy(player.root.position);
      tempProjVec.y += 2.15;
      tempProjVec.project(camera);
      const px = Math.round((tempProjVec.x * 0.5 + 0.5) * window.innerWidth);
      const py = Math.round((-(tempProjVec.y * 0.5) + 0.5) * window.innerHeight);
      player.labelEl.style.transform = `translate3d(${px}px, ${py}px, 0) translate(-50%, -100%)`;
    }

    // Update NPC Farmers & Remote Peers with GPU-accelerated translate3d
    const otherAvatars = [...npcFarmers.map(n => n.avatar), ...Array.from(remotePeers.values()).map(r => r.avatar)];
    otherAvatars.forEach((av) => {
      tempProjVec.copy(av.root.position);
      tempProjVec.y += 2.15;

      const distToCam = camera.position.distanceTo(tempProjVec);
      if (distToCam > 45) {
        av.labelEl.style.opacity = '0';
        return;
      }

      tempProjVec.project(camera);
      if (tempProjVec.z > 1) {
        av.labelEl.style.opacity = '0';
        return;
      }

      const x = Math.round((tempProjVec.x * 0.5 + 0.5) * window.innerWidth);
      const y = Math.round((-(tempProjVec.y * 0.5) + 0.5) * window.innerHeight);
      av.labelEl.style.opacity = '1';
      av.labelEl.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -100%)`;
    });
  }

  const minimapCanvas = document.getElementById('minimap-canvas');
  const mCtx = minimapCanvas.getContext('2d');

  function drawMinimap() {
    const w = minimapCanvas.width;
    const h = minimapCanvas.height;
    mCtx.clearRect(0, 0, w, h);

    // High-tech Tactical Radar Grid Rings & Crosshair
    mCtx.strokeStyle = 'rgba(0, 242, 152, 0.18)';
    mCtx.lineWidth = 1;
    mCtx.beginPath();
    mCtx.arc(w / 2, h / 2, w * 0.45, 0, Math.PI * 2);
    mCtx.arc(w / 2, h / 2, w * 0.30, 0, Math.PI * 2);
    mCtx.arc(w / 2, h / 2, w * 0.15, 0, Math.PI * 2);
    mCtx.moveTo(w / 2, 8); mCtx.lineTo(w / 2, h - 8);
    mCtx.moveTo(8, h / 2); mCtx.lineTo(w - 8, h / 2);
    mCtx.stroke();

    const mapScale = w / (WORLD_LIMIT * 2);
    const toMapX = (wx) => w / 2 + wx * mapScale;
    const toMapY = (wz) => h / 2 + wz * mapScale;

    // Central Walkway
    mCtx.fillStyle = 'rgba(217, 119, 6, 0.45)';
    mCtx.fillRect(w / 2 - 2.5, 0, 5, h);

    // Pillars (Vibrant Red for unstroked fruits, Emerald Green for complete)
    pillars.forEach((pil) => {
      const px = toMapX(pil.x);
      const py = toMapY(pil.z);
      const isPending = pil.remainingCount > 0;
      mCtx.fillStyle = isPending ? '#ff1361' : '#00f298';
      mCtx.beginPath();
      mCtx.arc(px, py, isPending ? 3.2 : 2.2, 0, Math.PI * 2);
      mCtx.fill();
    });

    // NPC Farmers & Peers
    mCtx.fillStyle = '#38bdf8';
    npcFarmers.forEach((npc) => {
      mCtx.beginPath();
      mCtx.arc(toMapX(npc.avatar.root.position.x), toMapY(npc.avatar.root.position.z), 2.4, 0, Math.PI * 2);
      mCtx.fill();
    });

    // Player with Heading / Vision Cone
    const px = toMapX(player.root.position.x);
    const py = toMapY(player.root.position.z);
    const pRot = player.root.rotation.y;

    // Vision cone
    mCtx.fillStyle = 'rgba(255, 190, 11, 0.3)';
    mCtx.beginPath();
    mCtx.moveTo(px, py);
    mCtx.arc(px, py, 15, -pRot - Math.PI / 2 - 0.5, -pRot - Math.PI / 2 + 0.5);
    mCtx.closePath();
    mCtx.fill();

    // Player Marker Dot with outer white ring
    mCtx.fillStyle = '#ffbe0b';
    mCtx.beginPath();
    mCtx.arc(px, py, 4.2, 0, Math.PI * 2);
    mCtx.fill();
    mCtx.strokeStyle = '#ffffff';
    mCtx.lineWidth = 1.5;
    mCtx.stroke();
  }

  // ==========================================
  // 10. MULTIPLAYER SYNC, CHAT & HUD EVENTS
  // ==========================================
  function broadcastPlayerState(chatMsg = null) {
    if (!netChannel || !state.joined) return;
    netChannel.postMessage({
      peerId: localPeerId,
      name: state.playerName,
      shirtColor: state.shirtColor,
      hatType: state.hatType,
      score: state.fruitsStroked,
      x: player.root.position.x,
      z: player.root.position.z,
      rotY: player.root.rotation.y,
      chat: chatMsg
    });
  }

  function removeRemotePeer(peerId) {
    const peer = remotePeers.get(peerId);
    if (!peer) return;
    if (peer.avatar && peer.avatar.root) {
      scene.remove(peer.avatar.root);
    }
    if (peer.avatar && peer.avatar.labelEl && peer.avatar.labelEl.parentNode) {
      peer.avatar.labelEl.parentNode.removeChild(peer.avatar.labelEl);
    }
    remotePeers.delete(peerId);
    updateHUD();
  }

  let lastPeerCleanup = 0;
  function cleanupStalePeers(now) {
    if (now - lastPeerCleanup < 500) return;
    lastPeerCleanup = now;
    for (const [peerId, peer] of remotePeers.entries()) {
      if (now - peer.lastSeen > 1600) {
        removeRemotePeer(peerId);
      }
    }
  }

  window.addEventListener('beforeunload', () => {
    if (netChannel && state.joined) {
      try {
        netChannel.postMessage({ type: 'leave', peerId: localPeerId });
      } catch (err) {}
    }
  });

  if (netChannel) {
    netChannel.onmessage = (ev) => {
      const data = ev.data;
      if (!data || data.peerId === localPeerId) return;

      if (data.type === 'leave') {
        removeRemotePeer(data.peerId);
        return;
      }

      let peer = remotePeers.get(data.peerId);
      if (!peer) {
        const avatar = createFarmerAvatar({
          name: data.name,
          shirtColor: data.shirtColor,
          hatType: data.hatType,
          isSelf: false
        });
        peer = { avatar, lastSeen: performance.now() };
        remotePeers.set(data.peerId, peer);
        addChatMessage('Hệ thống', `${data.name} vừa bước vào vườn thanh long!`, true);
        updateHUD();
      }

      peer.lastSeen = performance.now();
      peer.avatar.root.position.set(data.x, getWalkSurfaceHeight(data.x, data.z), data.z);
      peer.avatar.root.rotation.y = data.rotY;
      peer.avatar.updateScore(data.score || 0);

      if (data.shirtColor && peer.avatar.shirtColor !== data.shirtColor && peer.avatar.setShirtColor) {
        peer.avatar.setShirtColor(data.shirtColor);
      }
      if (data.hatType && peer.avatar.hatType !== data.hatType && peer.avatar.setHatType) {
        peer.avatar.setHatType(data.hatType);
      }

      if (data.chat) {
        peer.avatar.setChat(data.chat);
        addChatMessage(data.name, data.chat);
      }
    };
  }

  setInterval(() => {
    broadcastPlayerState();
  }, 200);

  function addChatMessage(sender, text, isSystem = false) {
    const box = document.getElementById('chat-messages');
    const line = document.createElement('div');
    line.className = `chat-line ${isSystem ? 'system-msg' : ''}`;
    line.innerHTML = isSystem ? `✨ ${text}` : `<b>${sender}:</b> ${text}`;
    box.appendChild(line);
    box.scrollTop = box.scrollHeight;

    // Mobile chat toast preview when chat drawer is closed
    const cPanel = document.getElementById('chat-panel');
    if (window.innerWidth <= 860 && cPanel && !cPanel.classList.contains('mobile-open')) {
      const unreadDot = document.getElementById('chat-unread-dot');
      if (unreadDot) unreadDot.classList.remove('hidden');

      const bubble = document.getElementById('mobile-chat-bubble');
      if (bubble) {
        bubble.innerHTML = isSystem ? `✨ ${text}` : `<b>${sender}:</b> ${text}`;
        bubble.classList.remove('hidden');
        clearTimeout(bubble._timer);
        bubble._timer = setTimeout(() => {
          bubble.classList.add('hidden');
        }, 4500);
      }
    }
  }

  function sendPlayerChat(msgText) {
    const clean = msgText.trim();
    if (!clean) return;
    player.setChat(clean);
    addChatMessage(state.playerName, clean);
    broadcastPlayerState(clean);

    // Auto-close chat drawer on mobile after sending
    if (window.innerWidth <= 860) {
      const cPanel = document.getElementById('chat-panel');
      if (cPanel) cPanel.classList.remove('mobile-open');
    }
  }

  document.getElementById('chat-send-btn').addEventListener('click', () => {
    const input = document.getElementById('chat-input');
    sendPlayerChat(input.value);
    input.value = '';
  });

  document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      sendPlayerChat(e.target.value);
      e.target.value = '';
      e.target.blur();
    } else if (e.key === 'Escape') {
      e.target.blur();
    }
  });

  document.querySelectorAll('.quick-chat-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      sendPlayerChat(chip.dataset.msg);
    });
  });

  const COLOR_NAMES = {
    '#e84393': 'Hồng Sen',
    '#0984e3': 'Xanh Biển',
    '#00b894': 'Xanh Lá Mạ',
    '#fdcb6e': 'Vàng Lúa',
    '#6c5ce7': 'Tím Hoa Cà',
    '#d63031': 'Đỏ Mận'
  };
  const HAT_NAMES = {
    'nonla': 'Nón Lá Truyền Thống',
    'taibeo': 'Mũ Tai Bèo Nông Dân'
  };

  function applyCostume(col, hat, skipSave = false) {
    if (col) state.shirtColor = col;
    if (hat) state.hatType = hat;

    if (player) {
      if (player.setShirtColor && state.shirtColor) player.setShirtColor(state.shirtColor);
      if (player.setHatType && state.hatType) player.setHatType(state.hatType);
    }

    if (!skipSave) {
      safeSetStorage('vt3d_color', state.shirtColor);
      safeSetStorage('vt3d_hat', state.hatType);
    }

    // Sync all color swatches in login and wardrobe modal
    document.querySelectorAll('.color-swatch').forEach(btn => {
      const isMatch = (btn.dataset.color || '').toLowerCase() === (state.shirtColor || '').toLowerCase();
      btn.classList.toggle('active', isMatch);
    });

    // Sync all hat buttons in login and wardrobe modal
    document.querySelectorAll('.hat-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.hat === state.hatType);
    });

    const cName = COLOR_NAMES[state.shirtColor.toLowerCase()] || state.shirtColor;
    const hName = HAT_NAMES[state.hatType] || state.hatType;
    const labelText = `Áo ${cName} • ${hName}`;
    const lTag = document.getElementById('login-costume-label');
    if (lTag) lTag.textContent = labelText;
    const oTag = document.getElementById('outfit-preview-label');
    if (oTag) oTag.textContent = labelText;

    const avatarDot = document.getElementById('login-avatar-dot');
    if (avatarDot) {
      avatarDot.style.backgroundColor = state.shirtColor;
      avatarDot.style.transform = 'scale(1.25)';
      setTimeout(() => { if (avatarDot) avatarDot.style.transform = 'scale(1)'; }, 180);
    }

    if (state.joined) {
      broadcastPlayerState();
    }
  }

  // Quick Random Authentic Vietnamese Farmer Names
  const RANDOM_FARMER_NAMES = [
    'Tư Long An', 'Bảy Châu Thành', 'Út Mót Chợ Gạo', 'Bé Ba Cần Đước',
    'Hai Tân An', 'Anh Ba Bến Lức', 'Thím Bảy Tân Trụ', 'Cô Năm Đức Hòa',
    'Bác Sáu Mộc Hóa', 'Năm Lúa Vĩnh Hưng', 'Bé Bông Tiền Giang', 'Chú Chín Thủ Thừa'
  ];

  const randomNameBtn = document.getElementById('random-name-btn');
  if (randomNameBtn) {
    randomNameBtn.addEventListener('click', () => {
      const nameInput = document.getElementById('player-name-input');
      const cur = nameInput ? nameInput.value.trim() : '';
      const pool = RANDOM_FARMER_NAMES.filter(n => n !== cur);
      const picked = pool[Math.floor(Math.random() * pool.length)];
      if (nameInput) {
        nameInput.value = picked;
        state.playerName = picked;
        safeSetStorage('vt3d_name', picked);
      }
      if (window.soundManager) window.soundManager.playPop();
    });
  }

  document.querySelectorAll('.color-swatch').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyCostume(btn.dataset.color, null);
    });
  });

  document.querySelectorAll('.hat-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      applyCostume(null, btn.dataset.hat);
    });
  });

  // Wardrobe / Outfit Modal Controls
  const outfitModal = document.getElementById('outfit-modal');
  const openOutfitBtn = document.getElementById('open-outfit-btn');
  const closeOutfitBtn = document.getElementById('close-outfit-btn');
  const saveOutfitBtn = document.getElementById('save-outfit-btn');

  function closeOutfitModal(withToast = false) {
    if (!outfitModal) return;
    outfitModal.classList.add('hidden');
    if (withToast) {
      showToast('✨ Đã cập nhật diện mạo mới cho thợ vườn!');
    }
  }

  if (openOutfitBtn && outfitModal) {
    openOutfitBtn.addEventListener('click', () => {
      applyCostume(state.shirtColor, state.hatType, true);
      outfitModal.classList.remove('hidden');
      if (window.lucide && window.lucide.createIcons) {
        window.lucide.createIcons();
      }
    });
  }

  if (closeOutfitBtn) closeOutfitBtn.addEventListener('click', () => closeOutfitModal(false));
  if (saveOutfitBtn) saveOutfitBtn.addEventListener('click', () => closeOutfitModal(true));

  function handleEnterWorld() {
    if (isEnteringWorld || state.joined) return;
    isEnteringWorld = true;

    if (document.activeElement) document.activeElement.blur();
    const nameVal = document.getElementById('player-name-input').value.trim() || 'Thợ Vuốt Long An';
    state.playerName = nameVal;
    state.joined = true;

    safeSetStorage('vt3d_name', state.playerName);
    applyCostume(state.shirtColor, state.hatType, false);

    player.name = state.playerName;
    player.nameTextEl.textContent = state.playerName;

    // Cinematic Intro Camera Setup
    enterIntroTimer = enterIntroTotal;
    introStartCamPos.set(0, 11.5, 54);
    camera.position.copy(introStartCamPos);
    const isPortIntro = window.innerHeight > window.innerWidth;
    camera.lookAt(player.root.position.x, player.root.position.y + 1.25 + 7.6 * (isPortIntro ? 0.145 : 0.075), player.root.position.z);

    // Audio & BGM
    if (window.soundManager) {
      window.soundManager.resume();
      window.soundManager.startBGM();
    }

    // Welcome Screen Smooth Dissolve & Scale
    const loginScreen = document.getElementById('login-screen');
    const hudLayer = document.getElementById('hud-layer');

    if (hudLayer) {
      hudLayer.classList.remove('hidden');
      hudLayer.classList.add('hud-entrance');
    }

    if (window.lucide && window.lucide.createIcons) {
      window.lucide.createIcons();
    }

    if (loginScreen) {
      loginScreen.classList.add('entering-game');
      setTimeout(() => {
        loginScreen.classList.add('hidden');
        loginScreen.classList.remove('entering-game');
      }, 750);
    }

    addChatMessage('Hợp Tác Xã Lí An', `Chào mừng ${state.playerName} đến Vườn Thanh Long Lí An! Bạn có thể dùng WASD để chạy hoặc click trực tiếp vào trụ thanh long để vuốt ngoe nhé!`, true);
    player.setChat('Chào bà con! Mình vào vuốt ngoe thanh long đây! 🖐️');
    updateHUD();
  }

  const enterBtn = document.getElementById('enter-world-btn');
  if (enterBtn) enterBtn.addEventListener('click', handleEnterWorld);

  const nameInputEl = document.getElementById('player-name-input');
  if (nameInputEl) {
    nameInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleEnterWorld();
      }
    });
  }

  const perfBtn = document.getElementById('toggle-perf-btn');
  if (perfBtn) {
    perfBtn.addEventListener('click', () => {
      setEcoMode(!perfSettings.isEco);
    });
  }

  document.getElementById('toggle-time-btn').addEventListener('click', () => {
    state.isNight = !state.isNight;
    if (state.isNight) {
      scene.background.setHex(0x060b19);
      scene.fog.color.setHex(0x0b132b);
      if (skyDomeMesh) skyDomeMesh.material.map = skyNightTex;
      hemiLight.intensity = 0.25;
      sunLight.intensity = 0.15;
      nightLights.forEach(l => (l.intensity = 1.45));
      nightBulbMeshes.forEach(b => (b.mesh.material = b.matOn));
      if (sunMesh) sunMesh.visible = false;
      if (moonMesh) moonMesh.visible = true;
      if (firefliesGroup) firefliesGroup.visible = true;
      const tIcon = document.getElementById('time-icon');
      if (tIcon && window.lucide) tIcon.innerHTML = window.lucide.createSvg('sun');
      document.getElementById('time-label').textContent = 'Ban Ngày';
      showToast('Đã bật dàn đèn chong thanh long ban đêm rực rỡ!');
    } else {
      scene.background.setHex(0x64b5f6);
      scene.fog.color.setHex(0x7ec8e3);
      if (skyDomeMesh) skyDomeMesh.material.map = skyDayTex;
      hemiLight.intensity = 0.65;
      sunLight.intensity = 0.95;
      nightLights.forEach(l => (l.intensity = 0));
      nightBulbMeshes.forEach(b => (b.mesh.material = b.matOff));
      if (sunMesh) sunMesh.visible = true;
      if (moonMesh) moonMesh.visible = false;
      if (firefliesGroup) firefliesGroup.visible = false;
      const tIcon = document.getElementById('time-icon');
      if (tIcon && window.lucide) tIcon.innerHTML = window.lucide.createSvg('moon');
      document.getElementById('time-label').textContent = 'Chong Đèn Đêm';
      showToast('Đã chuyển sang bầu trời nắng sớm!');
    }
  });

  // Virtual Touch Controller Toggle Button (Chuyển chế độ: Cần gạt động Liên Quân / Bàn phím D-Pad / Tắt)
  const toggleTouchBtn = document.getElementById('toggle-touch-btn');
  const dpadBox = document.getElementById('dpad-container');
  if (toggleTouchBtn && dpadBox) {
    let touchMode = 0; // 0: Dynamic Liên Quân Joystick (Mặc định), 1: Cụm D-Pad cố định, 2: Tắt
    toggleTouchBtn.classList.add('active');
    dpadBox.classList.add('hidden-on-desktop'); // Mặc định ẩn trên desktop, tránh đè lên thanh phím điều khiển!

    toggleTouchBtn.addEventListener('click', () => {
      touchMode = (touchMode + 1) % 3;
      if (touchMode === 0) {
        document.body.classList.remove('force-show-dpad');
        document.body.classList.remove('disable-touch-controls');
        dpadBox.classList.add('hidden-on-desktop');
        toggleTouchBtn.classList.add('active');
        showToast('🕹️ Chế độ Cần gạt động (Vuốt chạm tự hiện kiểu Liên Quân)');
      } else if (touchMode === 1) {
        document.body.classList.add('force-show-dpad');
        document.body.classList.remove('disable-touch-controls');
        dpadBox.classList.remove('hidden-on-desktop');
        toggleTouchBtn.classList.add('active');
        showToast('🎮 Chế độ Bàn phím D-Pad cố định');
      } else {
        document.body.classList.remove('force-show-dpad');
        document.body.classList.add('disable-touch-controls');
        dpadBox.classList.add('hidden-on-desktop');
        toggleTouchBtn.classList.remove('active');
        showToast('⌨️ Đã tắt phím ảo điều khiển');
      }
    });
  }

  // Chat Panel Minimize / Expand Toggle (Desktop & Mobile)
  const chatToggleBtn = document.getElementById('chat-toggle-btn');
  const chatPanel = document.getElementById('chat-panel');
  if (chatToggleBtn && chatPanel) {
    chatToggleBtn.addEventListener('click', () => {
      const isCol = chatPanel.classList.toggle('collapsed');
      chatToggleBtn.textContent = isCol ? '+' : '−';
      chatToggleBtn.title = isCol ? 'Mở rộng trò chuyện' : 'Thu gọn trò chuyện';
    });
  }

  // Mobile Chat Pill & Drawer Controls
  const mobileChatBtn = document.getElementById('mobile-chat-btn');
  const closeChatMobileBtn = document.getElementById('close-chat-mobile-btn');
  const chatInput = document.getElementById('chat-input');
  if (mobileChatBtn && chatPanel) {
    mobileChatBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (window.innerWidth <= 860) {
        chatPanel.classList.add('mobile-open');
        const unreadDot = document.getElementById('chat-unread-dot');
        if (unreadDot) unreadDot.classList.add('hidden');
        const bubble = document.getElementById('mobile-chat-bubble');
        if (bubble) bubble.classList.add('hidden');
        if (chatInput) setTimeout(() => chatInput.focus(), 150);
      } else {
        chatPanel.classList.remove('collapsed');
        if (chatToggleBtn) chatToggleBtn.textContent = '−';
        if (chatInput) chatInput.focus();
      }
    });
  }
  if (closeChatMobileBtn && chatPanel) {
    closeChatMobileBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      chatPanel.classList.remove('mobile-open');
      if (chatInput) chatInput.blur();
    });
  }

  // Mobile More Settings Dropdown Toggle (Gộp Phím Ảo / GPU / Camera)
  const moreBtn = document.getElementById('toggle-more-btn');
  const extraTools = document.getElementById('hud-extra-tools');
  if (moreBtn && extraTools) {
    moreBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      extraTools.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
      if (extraTools && !extraTools.contains(e.target) && e.target !== moreBtn && !moreBtn.contains(e.target)) {
        extraTools.classList.remove('open');
      }
    });
  }

  // Minimap Radar Minimize / Expand Toggle
  const minimapToggleBtn = document.getElementById('minimap-toggle-btn');
  const minimapPanel = document.getElementById('minimap-panel');
  if (minimapToggleBtn && minimapPanel) {
    minimapToggleBtn.addEventListener('click', () => {
      const isCol = minimapPanel.classList.toggle('collapsed');
      minimapToggleBtn.textContent = isCol ? '+' : '−';
      minimapToggleBtn.title = isCol ? 'Mở rộng radar' : 'Thu gọn radar';
    });
  }

  document.getElementById('toggle-camera-btn').addEventListener('click', () => {
    state.cameraMode = (state.cameraMode + 1) % 3;
    safeSetStorage('vt3d_cam_mode', state.cameraMode.toString());
    camZoomOffset = 0;
    const labels = ['Góc nhìn chuẩn sau lưng', 'Góc nhìn toàn cảnh vườn', 'Góc nhìn gần'];
    showToast(`🎥 Đã đổi sang: ${labels[state.cameraMode]}`);
  });

  // Mobile & Desktop Fullscreen Controller (Toàn Màn Hình)
  const fullscreenBtn = document.getElementById('toggle-fullscreen-btn');
  const fullscreenIcon = document.getElementById('fullscreen-icon');
  const fullscreenLabel = document.getElementById('fullscreen-label');

  function updateFullscreenUI(isFull) {
    if (fullscreenBtn) {
      if (isFull) {
        fullscreenBtn.classList.add('active');
        if (fullscreenLabel) fullscreenLabel.textContent = 'Thu Nhỏ';
        if (fullscreenIcon && window.lucide && window.lucide.createSvg) {
          fullscreenIcon.innerHTML = window.lucide.createSvg('minimize');
        }
      } else {
        fullscreenBtn.classList.remove('active');
        if (fullscreenLabel) fullscreenLabel.textContent = 'Toàn Màn Hình';
        if (fullscreenIcon && window.lucide && window.lucide.createSvg) {
          fullscreenIcon.innerHTML = window.lucide.createSvg('maximize');
        }
      }
    }
  }

  function toggleFullscreen() {
    const doc = document;
    const docEl = document.documentElement;
    const isFull = !!(doc.fullscreenElement || doc.webkitFullscreenElement || doc.mozFullScreenElement || doc.msFullscreenElement);

    if (!isFull) {
      const req = docEl.requestFullscreen || docEl.webkitRequestFullscreen || docEl.mozRequestFullScreen || docEl.msRequestFullscreen;
      if (req) {
        req.call(docEl).then(() => {
          updateFullscreenUI(true);
          showToast('📺 Đã bật chế độ Toàn Màn Hình!');
        }).catch(() => {
          showToast('💡 Mẹo iPhone: Nhấn Chia sẻ > "Thêm vào MH chính" để full màn hình 100%!');
        });
      } else {
        showToast('💡 Mẹo iPhone: Nhấn Chia sẻ > "Thêm vào MH chính" để full màn hình 100%!');
      }
    } else {
      const exit = doc.exitFullscreen || doc.webkitExitFullscreen || doc.mozCancelFullScreen || doc.msExitFullscreen;
      if (exit) {
        exit.call(doc).then(() => {
          updateFullscreenUI(false);
          showToast('Đã thoát chế độ Toàn Màn Hình.');
        }).catch(() => {
          updateFullscreenUI(false);
        });
      }
    }
  }

  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', toggleFullscreen);
  }

  ['fullscreenchange', 'webkitfullscreenchange', 'mozfullscreenchange', 'MSFullscreenChange'].forEach(evt => {
    document.addEventListener(evt, () => {
      const isFull = !!(document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement);
      updateFullscreenUI(isFull);
      setTimeout(() => {
        updateCameraViewport();
      }, 120);
    });
  });

  document.getElementById('toggle-sound-btn').addEventListener('click', () => {
    if (!window.soundManager) return;
    const muted = window.soundManager.toggleMute();
    const sIcon = document.getElementById('sound-icon');
    if (sIcon && window.lucide) {
      sIcon.innerHTML = window.lucide.createSvg(muted ? 'volume-x' : 'volume-2');
    }
    showToast(muted ? 'Đã tắt âm thanh' : 'Đã bật âm thanh ASMR & nhạc vườn');
  });

  // Desktop Controls Guide Toggle (Bật / Tắt thanh hướng dẫn phím)
  const controlsHud = document.getElementById('controls-hud');
  const reopenGuideBtn = document.getElementById('reopen-guide-btn');
  const dismissGuideBtn = document.getElementById('dismiss-guide-btn');

  function setControlsGuideVisible(show) {
    if (!controlsHud) return;
    if (show) {
      controlsHud.classList.remove('hidden-guide');
      if (reopenGuideBtn) reopenGuideBtn.classList.add('hidden');
      safeSetStorage('vt3d_show_guide', '1');
    } else {
      controlsHud.classList.add('hidden-guide');
      if (reopenGuideBtn) reopenGuideBtn.classList.remove('hidden');
      safeSetStorage('vt3d_show_guide', '0');
    }
  }

  function toggleControlsGuide() {
    if (!controlsHud) return;
    const isHidden = controlsHud.classList.contains('hidden-guide');
    setControlsGuideVisible(isHidden);
  }

  if (dismissGuideBtn) {
    dismissGuideBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setControlsGuideVisible(false);
    });
  }

  if (reopenGuideBtn) {
    reopenGuideBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      setControlsGuideVisible(true);
    });
  }

  // Restore saved guide preference
  if (safeGetStorage('vt3d_show_guide', '1') === '0') {
    setControlsGuideVisible(false);
  }

  const lbModal = document.getElementById('leaderboard-modal');
  document.getElementById('open-leaderboard-btn').addEventListener('click', () => {
    renderLeaderboard();
    lbModal.classList.remove('hidden');
  });
  document.getElementById('close-leaderboard-btn').addEventListener('click', () => {
    lbModal.classList.add('hidden');
  });

  function renderLeaderboard() {
    const rowsEl = document.getElementById('leaderboard-rows');
    rowsEl.innerHTML = '';

    const list = [
      { name: state.playerName + ' (Bạn)', score: state.fruitsStroked, isMe: true },
      ...npcFarmers.map(n => ({ name: n.avatar.name, score: n.avatar.score, isMe: false })),
      ...Array.from(remotePeers.values()).map(r => ({ name: r.avatar.name, score: r.avatar.score, isMe: false }))
    ];
    list.sort((a, b) => b.score - a.score);

    list.forEach((item, idx) => {
      const medal = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `#${idx + 1}`;
      const row = document.createElement('div');
      row.className = `lb-row ${item.isMe ? 'is-me' : ''}`;
      row.innerHTML = `
        <span>${medal} ${item.name}</span>
        <b>${item.score} trái Loại 1 ${getDragonFruitBadgeHtml()}</b>
      `;
      rowsEl.appendChild(row);
    });
  }

  function formatMoneyK(amount) {
    const n = Number(amount) || 0;
    if (n >= 1000) {
      const kVal = Math.floor(n / 1000);
      return kVal.toLocaleString('vi-VN') + 'K';
    }
    return n.toLocaleString('vi-VN') + 'K';
  }

  function updateHUD() {
    const moneyEl = document.getElementById('hud-money');
    if (moneyEl) moneyEl.textContent = formatMoneyK(state.money);
    const fruitEl = document.getElementById('hud-fruits');
    if (fruitEl) fruitEl.textContent = state.fruitsStroked;
    const onlineEl = document.getElementById('hud-online');
    if (onlineEl) onlineEl.textContent = 1 + npcFarmers.length + remotePeers.size;
  }

  function showToast(text) {
    const box = document.getElementById('toast-box');
    box.textContent = text;
    box.classList.remove('hidden');
    clearTimeout(box._timer);
    box._timer = setTimeout(() => {
      box.classList.add('hidden');
    }, 2400);
  }

  window.addEventListener('resize', () => {
    updateCameraViewport();
  });

  // ==========================================
  // 11. MAIN 3D ANIMATION LOOP
  // ==========================================
  if (nameInputEl) nameInputEl.value = state.playerName;
  applyCostume(state.shirtColor, state.hatType, true);
  updateHUD();

  let lastTime = performance.now();
  let lastMinimapDraw = 0;
  let initialPrerenderDone = false;
  function animate(now) {
    requestAnimationFrame(animate);
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;

    // Tách riêng Welcome Screen: Tiết kiệm 100% GPU/CPU khi ở màn hình chào
    if (!state.joined) {
      if (!initialPrerenderDone) {
        // Render 1 frame chuẩn bị VRAM và biên dịch Shader trước
        renderer.render(scene, camera);
        initialPrerenderDone = true;
      }
      return;
    }

    updatePlayerAndCamera(dt);
    updateNPCs(dt);
    cleanupStalePeers(now);
    updateCloseupFruitAndParticles(dt);
    updateFloatingLabels();

    if (now - lastMinimapDraw > 80) {
      lastMinimapDraw = now;
      drawMinimap();
    }
    updateEnvironment(dt);

    renderer.render(scene, camera);
  }

  requestAnimationFrame(animate);
})();
