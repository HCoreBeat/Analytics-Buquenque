import * as THREE from 'three';
import { OrbitControls } from 'https://unpkg.com/three@0.154.0/examples/jsm/controls/OrbitControls.js';

// Config
const EARTH_RADIUS = 10;
const EARTH_SEGMENTS = 50;
const TEXTURE_URL = './Img/earth.jpg';

// Helper: lat/lng -> 3D position on sphere of given radius
function latLngToVector3(lat, lng, radius) {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lng + 180) * (Math.PI / 180);

    const x = - (radius) * Math.sin(phi) * Math.cos(theta);
    const y = (radius) * Math.cos(phi);
    const z = (radius) * Math.sin(phi) * Math.sin(theta);

    return new THREE.Vector3(x, y, z);
}

async function createGlobe() {
    // Container
    const container = document.getElementById('globe-container');
    if (!container) return console.warn('globe-container not found');

    // Scene, camera, renderer
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(0, 0, 30);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(window.devicePixelRatio || 1);
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);
    // mark canvas for CSS targeting and identify engine/version
    try {
        renderer.domElement.classList.add('globe-canvas');
        renderer.domElement.setAttribute('data-engine', 'three.js r154');
    } catch (e) { /* ignore in very old browsers */ }

    // Lights: hemisphere + directional + ambient
    const hemi = new THREE.HemisphereLight(0xddeeff, 0x222233, 0.6);
    scene.add(hemi);

    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(5, 3, 5);
    dir.castShadow = false;
    scene.add(dir);

    scene.add(new THREE.AmbientLight(0xffffff, 0.25));

    // Earth
    const loader = new THREE.TextureLoader();
    const earthGeometry = new THREE.SphereGeometry(EARTH_RADIUS, EARTH_SEGMENTS, EARTH_SEGMENTS);
    // Load texture safely; fallback to flat color if fails
    let earthMaterial;
    try {
        const tex = await new Promise((res, rej) => loader.load(TEXTURE_URL, res, undefined, rej));
        // Ensure correct color space and filtering for better visual results
        try {
            tex.encoding = THREE.sRGBEncoding;
        } catch (e) { /* ignore if property missing */ }
        try {
            tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
        } catch (e) { /* ignore */ }
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        earthMaterial = new THREE.MeshStandardMaterial({ map: tex, metalness: 0.0, roughness: 0.9 });
        earthMaterial.needsUpdate = true;
    } catch (err) {
        console.warn('globe: no se pudo cargar textura local', err);
        earthMaterial = new THREE.MeshStandardMaterial({ color: 0x2266aa, metalness: 0.0, roughness: 1.0 });
    }

    const earth = new THREE.Mesh(earthGeometry, earthMaterial);
    earth.name = 'tierra';
    scene.add(earth);

    // Atmosphere: slightly larger, BackSide, additive blending for glow
    const atmosphereMaterial = new THREE.MeshPhongMaterial({
        color: 0x7fb9ff,
        transparent: true,
        opacity: 0.12,
        side: THREE.BackSide,
        blending: THREE.AdditiveBlending
    });
    const atmosphere = new THREE.Mesh(earthGeometry.clone(), atmosphereMaterial);
    atmosphere.scale.set(1.03, 1.03, 1.03);
    earth.add(atmosphere);

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 12;
    controls.maxDistance = 50;

    // Load data files
    const [dataResp, coordsResp] = await Promise.all([
        fetch('./Json/my_data.json'),
        fetch('./Json/countries_latlng.json')
    ]);

    const userData = await dataResp.json();
    const countries = await coordsResp.json();

    // For each record, map country -> lat/lng and plot
    const plotted = new Set();
    const dots = [];
    // aggregate counts per country for tooltip info
    const countryCounts = {};
    for (const r of userData) {
        const c = (r.pais || r.Pais || '').toUpperCase();
        if (!c) continue;
        countryCounts[c] = (countryCounts[c] || 0) + 1;
    }

    // read CSS variables for marker styling (prefer :root so global CSS can override)
    const rootCss = getComputedStyle(document.documentElement);
    const css = getComputedStyle(container);
    const markerColorRaw = (rootCss.getPropertyValue('--globe-marker-color').trim() || css.getPropertyValue('--globe-marker-color').trim() || '#ff3333');
    let markerColor;
    try { markerColor = new THREE.Color(markerColorRaw); } catch (e) { markerColor = new THREE.Color('#ff3333'); }
    const markerSphereR = parseFloat(rootCss.getPropertyValue('--globe-marker-sphere-radius')) || parseFloat(css.getPropertyValue('--globe-marker-sphere-radius')) || 0.14;
    const markerConeH = parseFloat(rootCss.getPropertyValue('--globe-marker-cone-height')) || parseFloat(css.getPropertyValue('--globe-marker-cone-height')) || 1.2;
    const markerConeR = parseFloat(rootCss.getPropertyValue('--globe-marker-cone-radius')) || parseFloat(css.getPropertyValue('--globe-marker-cone-radius')) || 0.12;
    const markerOpacity = parseFloat(rootCss.getPropertyValue('--globe-marker-opacity')) || parseFloat(css.getPropertyValue('--globe-marker-opacity')) || 0.95;

    for (const record of userData) {
        const code = (record.pais || record.Pais || '').toUpperCase();
        if (!code) continue;

        const coord = countries[code];
        if (!coord) continue;

        // Avoid plotting duplicate points for same country multiple times
        const plotKey = `${code}_${coord.lat}_${coord.lng}`;
        if (plotted.has(plotKey)) continue;
        plotted.add(plotKey);

        // place marker slightly outside the globe surface using sphere radius + small epsilon
        const pos = latLngToVector3(coord.lat, coord.lng, EARTH_RADIUS + markerSphereR + 0.03);

        // marker material from CSS variable (use THREE.Color to be robust)
        const mat = new THREE.MeshBasicMaterial({ color: markerColor, transparent: true, opacity: markerOpacity, blending: THREE.AdditiveBlending, depthWrite: false });

        // small glowing sphere
        const sphereGeo = new THREE.SphereGeometry(markerSphereR, 12, 8);
        const sphere = new THREE.Mesh(sphereGeo, mat);
        sphere.position.copy(new THREE.Vector3(0, 0, 0)); // will be set by group

        // cone (beam) pointing outward from globe center
        const coneGeo = new THREE.ConeGeometry(markerConeR, markerConeH, 12);
        const cone = new THREE.Mesh(coneGeo, mat);

        // direction from center outward
        const dir = pos.clone().normalize();

        // group marker: position group at pos, then offset children so scaling affects only sphere if needed
        const markerGroup = new THREE.Group();
        markerGroup.position.copy(pos);

        // sphere sits at the group's origin
        sphere.position.set(0, 0, 0);

        // cone should extend outward from the sphere along dir; position it using group's local coordinates
        const coneOffset = dir.clone().multiplyScalar(markerConeH / 2 + markerSphereR * 0.1);
        cone.position.copy(coneOffset);
        cone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

        markerGroup.add(sphere);
        markerGroup.add(cone);
        markerGroup.userData = { code, count: countryCounts[code] || 1, __sphere: sphere, __cone: cone, __dir: dir.clone(), __basePos: pos.clone() };

        earth.add(markerGroup);
        dots.push(markerGroup);
    }

    // Starfield background (simple using Points)
    const starsGeometry = new THREE.BufferGeometry();
    const starCount = 1000;
    const positions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
        const r = THREE.MathUtils.randFloat(120, 400);
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(THREE.MathUtils.randFloatSpread(2));
        positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
        positions[i * 3 + 1] = r * Math.cos(phi);
        positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    starsGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const starsMaterial = new THREE.PointsMaterial({ color: 0xffffff, size: 1.8, opacity: 0.9, transparent: true });
    const starField = new THREE.Points(starsGeometry, starsMaterial);
    scene.add(starField);


    // Tooltip element for hover
    const tooltip = document.createElement('div');
    tooltip.id = 'globe-tooltip';
    document.body.appendChild(tooltip);

    // Helper to update marker styles dynamically (reads CSS variables again)
    function updateMarkerStyles() {
        const rootCss2 = getComputedStyle(document.documentElement);
        const css2 = getComputedStyle(container);
        const colRaw = (rootCss2.getPropertyValue('--globe-marker-color').trim() || css2.getPropertyValue('--globe-marker-color').trim() || '#ff3333');
        let col;
        try { col = new THREE.Color(colRaw); } catch (e) { col = new THREE.Color('#ff3333'); }
        const op = parseFloat(rootCss2.getPropertyValue('--globe-marker-opacity')) || parseFloat(css2.getPropertyValue('--globe-marker-opacity')) || markerOpacity;
        for (let i = 0; i < dots.length; i++) {
            const mg = dots[i];
            if (!mg || !mg.userData) continue;
            const s = mg.userData.__sphere;
            const c = mg.userData.__cone;
            if (s && s.material) {
                s.material.color.copy(col);
                s.material.opacity = op;
                s.material.needsUpdate = true;
            }
            if (c && c.material) {
                c.material.color.copy(col);
                c.material.opacity = op;
                c.material.needsUpdate = true;
            }
        }
    }

    // Watch for class/attribute changes on body to allow dynamic CSS presets (e.g., body.globe-blue)
    const mo = new MutationObserver((mutations) => {
        for (const m of mutations) {
            if (m.type === 'attributes' && (m.attributeName === 'class' || m.attributeName === 'style')) {
                updateMarkerStyles();
                break;
            }
        }
    });
    try { mo.observe(document.body, { attributes: true }); } catch (e) { /* ignore if not allowed */ }

    // apply once at start
    updateMarkerStyles();

    // Raycaster for interaction
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2(-10, -10);
    renderer.domElement.addEventListener('pointermove', (e) => {
        const rect = renderer.domElement.getBoundingClientRect();
        pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        // position tooltip tentatively
        tooltip.style.left = (e.clientX + 12) + 'px';
        tooltip.style.top = (e.clientY + 12) + 'px';
    });

    // Animation loop
    const animate = function () {
        requestAnimationFrame(animate);
        // slow auto-rotation
        earth.rotation.y += 0.0008;
        controls.update();

        // animate dots (pulse)
        const time = performance.now() * 0.002;
        for (let i = 0; i < dots.length; i++) {
            const d = dots[i];
            const s = 1 + 0.12 * Math.sin(time + i);
            d.scale.setScalar(s);
        }

        // hover detection
        raycaster.setFromCamera(pointer, camera);
        const intersects = raycaster.intersectObjects(dots, true);
        if (intersects.length > 0) {
            // find parent group that has our userData (markerGroup)
            let hitObj = intersects[0].object;
            while (hitObj && !(hitObj.userData && hitObj.userData.code) && hitObj.parent) {
                hitObj = hitObj.parent;
            }
            const ud = (hitObj && hitObj.userData) ? hitObj.userData : {};
            tooltip.style.display = 'block';
            tooltip.textContent = `${ud.code || ''} — ${ud.count || 1} registro(s)`;
        } else {
            tooltip.style.display = 'none';
        }

        renderer.render(scene, camera);
    };

    animate();

    // Responsive: observe container size changes
    const ro = new ResizeObserver(() => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(w, h);
    });
    ro.observe(container);
}

// Auto-init when DOM ready
if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', createGlobe);
} else {
    createGlobe();
}
