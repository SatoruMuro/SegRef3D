import * as THREE from "./vendor/three.module.min.js";

// Weighted blended OIT (McGuire/Bavoil). Two portable blending passes avoid
// requiring indexed per-attachment blending, WebGPU, or stochastic alphaHash.
// The opaque depth texture rejects hidden fragments in both transparent passes.
export function createPreviewTransparency(renderer) {
  if (!renderer.extensions.has("EXT_color_buffer_float")) return null;
  const opaque = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  opaque.depthTexture = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
  const accumulation = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const revealage = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false });
  // Keep MSAA on supported WebGL2 targets, including the resolved opaque depth.
  const gl = renderer.getContext();
  const sampleCounts = [gl.RGBA16F, gl.RGBA8, gl.DEPTH_COMPONENT24]
    .map((format) => [...gl.getInternalformatParameter(gl.RENDERBUFFER, format, gl.SAMPLES)]);
  const samples = Math.max(0, ...sampleCounts[0].filter((n) => n <= 4 && sampleCounts.every((counts) => counts.includes(n))));
  for (const target of [opaque, accumulation, revealage]) target.samples = samples;
  const initialTarget = renderer.getRenderTarget();
  let supported = true;
  try {
    for (const target of [opaque, accumulation, revealage]) {
      renderer.setRenderTarget(target);
      supported &&= gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    }
  } finally { renderer.setRenderTarget(initialTarget); }
  if (!supported) { opaque.dispose(); accumulation.dispose(); revealage.dispose(); return null; }
  const uniforms = {
    opaqueDepth: { value: opaque.depthTexture },
    viewportSize: { value: new THREE.Vector2(1, 1) },
    depthScale: { value: 1 },
  };
  const depthDeclarations = "uniform sampler2D opaqueDepth;\nuniform vec2 viewportSize;\nuniform float depthScale;\n";
  const depthTest = "if (gl_FragCoord.z > texture2D(opaqueDepth, gl_FragCoord.xy / viewportSize).r) discard;\n";
  const materials = new Map();
  const getMaterials = (source) => {
    if (!materials.has(source)) {
      const weighted = source.clone();
      weighted.transparent = true;
      weighted.depthWrite = false;
      weighted.forceSinglePass = true;
      weighted.blending = THREE.CustomBlending;
      weighted.blendSrc = THREE.OneFactor;
      weighted.blendDst = THREE.OneFactor;
      weighted.blendEquation = THREE.AddEquation;
      weighted.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.fragmentShader = depthDeclarations + shader.fragmentShader
          .replace("#include <opaque_fragment>", `${depthTest}
            float weight = clamp(1.0 / (0.01 + pow(length(vViewPosition) / depthScale, 4.0)), 0.01, 8.0);
            gl_FragColor = vec4(outgoingLight * diffuseColor.a, diffuseColor.a) * weight;`)
          .replace("#include <tonemapping_fragment>", "")
          .replace("#include <colorspace_fragment>", "");
      };
      weighted.customProgramCacheKey = () => "preview-weighted-oit-v1";
      const reveal = new THREE.MeshBasicMaterial({
        side: THREE.DoubleSide, transparent: true, depthWrite: false,
        forceSinglePass: true, blending: THREE.CustomBlending,
        blendSrc: THREE.ZeroFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
        blendEquation: THREE.AddEquation,
      });
      reveal.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.fragmentShader = depthDeclarations + shader.fragmentShader
          .replace("#include <opaque_fragment>", `${depthTest} gl_FragColor = vec4(0.0, 0.0, 0.0, diffuseColor.a);`)
          .replace("#include <tonemapping_fragment>", "")
          .replace("#include <colorspace_fragment>", "");
      };
      reveal.customProgramCacheKey = () => "preview-revealage-v1";
      materials.set(source, { weighted, reveal });
    }
    const pair = materials.get(source);
    pair.weighted.opacity = pair.reveal.opacity = source.opacity;
    return pair;
  };

  const compositeMaterial = new THREE.ShaderMaterial({
    uniforms: { opaqueColor: { value: opaque.texture }, accumulation: { value: accumulation.texture }, revealage: { value: revealage.texture } },
    depthTest: false, depthWrite: false,
    vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader: `
      uniform sampler2D opaqueColor;
      uniform sampler2D accumulation;
      uniform sampler2D revealage;
      varying vec2 vUv;
      void main() {
        vec4 accum = texture2D(accumulation, vUv);
        float reveal = texture2D(revealage, vUv).r;
        vec3 transparentColor = accum.rgb / max(accum.a, 0.00001);
        vec3 color = mix(transparentColor, texture2D(opaqueColor, vUv).rgb, reveal);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compositeMaterial);
  const compositeScene = new THREE.Scene(); compositeScene.add(quad);
  const compositeCamera = new THREE.Camera();
  const bufferSize = new THREE.Vector2();

  return {
    render(scene, camera, surfaces, target) {
      const entries = [...surfaces.values()].map((surface) => ({ surface, material: surface.material, visible: surface.visible }));
      if (!entries.some(({ visible, material }) => visible && material.transparent && material.opacity > 0)) {
        renderer.render(scene, camera);
        return;
      }
      renderer.getDrawingBufferSize(bufferSize);
      if (!uniforms.viewportSize.value.equals(bufferSize)) {
        for (const rt of [opaque, accumulation, revealage]) rt.setSize(bufferSize.x, bufferSize.y);
        uniforms.viewportSize.value.copy(bufferSize);
      }
      uniforms.depthScale.value = Math.max(camera.position.distanceTo(target), camera.near);
      const previousTarget = renderer.getRenderTarget();
      const clearColor = renderer.getClearColor(new THREE.Color()), clearAlpha = renderer.getClearAlpha();
      const autoClear = renderer.autoClear;
      try {
        renderer.autoClear = false;
        for (const item of entries) item.surface.visible = item.visible && !item.material.transparent;
        renderer.setRenderTarget(opaque); renderer.setClearColor(clearColor, clearAlpha); renderer.clear(); renderer.render(scene, camera);
        for (const item of entries) item.surface.visible = item.visible && item.material.transparent && item.material.opacity > 0;
        for (const item of entries) if (item.surface.visible) item.surface.material = getMaterials(item.material).weighted;
        renderer.setRenderTarget(accumulation); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(scene, camera);
        for (const item of entries) if (item.surface.visible) item.surface.material = getMaterials(item.material).reveal;
        renderer.setRenderTarget(revealage); renderer.setClearColor(0xffffff, 1); renderer.clear(); renderer.render(scene, camera);
        renderer.setRenderTarget(previousTarget); renderer.render(compositeScene, compositeCamera);
      } finally {
        for (const item of entries) { item.surface.visible = item.visible; item.surface.material = item.material; }
        renderer.setRenderTarget(previousTarget); renderer.setClearColor(clearColor, clearAlpha); renderer.autoClear = autoClear;
      }
    },
    dispose() {
      opaque.dispose(); accumulation.dispose(); revealage.dispose();
      for (const pair of materials.values()) { pair.weighted.dispose(); pair.reveal.dispose(); }
      materials.clear(); quad.geometry.dispose(); compositeMaterial.dispose();
    },
  };
}
