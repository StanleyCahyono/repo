/**
 * The skier avatar scene (three.js): a rigged human body in ski gear on a glowing pad, with idle / carve / celebrate /
 * sleep poses blended procedurally and a "holo" look (fresnel rim, scanlines, sweep band, flicker, glitch).
 *
 * Loaded lazily by <SkierAvatar/> (dynamic import), so three.js only downloads when the avatar is on screen. The body
 * is the bundled src/assets/skier-body.glb (served same-origin; inlined in the single-file build) — nothing loads
 * from a CDN. Stylised, never generated from photos; nothing about the user leaves the device.
 */
import * as T from 'three'
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js'
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'

export type SkierState = 'auto' | 'idle' | 'carve' | 'celebrate' | 'sleep'
export type SkierLook = 'suit' | 'holo'

export interface SkierOptions {
  look: SkierLook
  state: SkierState
  jacket: string
  pants: string
  helmet: string
  gloves: string
  boots: string
  skis: string
  skin: string
  rim: string
  backpack: boolean
  poles: boolean
  pad: boolean
  /** Drag to turn the avatar. */
  drag: boolean
  /** Camera distance. */
  distance: number
}

export const DEFAULT_SKIER: SkierOptions = {
  look: 'suit',
  state: 'auto',
  jacket: '#f1f4f7',
  pants: '#22374a',
  helmet: '#f4f6f8',
  gloves: '#1b2733',
  boots: '#1b2733',
  skis: '#13202c',
  skin: '#c99a7a',
  rim: '#2a9fd6',
  backpack: false,
  poles: true,
  pad: true,
  drag: false,
  distance: 6.2,
}

const PAD_VS = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`
const PAD_FS = `uniform vec3 uRim; uniform float uTime; varying vec2 vUv;
void main(){ vec2 p=vUv*2.0-1.0; float r=length(p);
  float ring=smoothstep(0.018,0.0,abs(r-0.96))+smoothstep(0.012,0.0,abs(r-0.7))*0.5;
  float pulse=smoothstep(0.03,0.0,abs(r-fract(uTime*0.3)))*(1.0-fract(uTime*0.3));
  float glow=smoothstep(0.9,0.0,r)*0.28;
  float ticks=step(0.92,fract(atan(p.y,p.x)*9.549))*smoothstep(0.025,0.0,abs(r-0.84));
  float a=clamp(ring+pulse*0.7+glow+ticks*0.7,0.0,1.0)*step(r,1.0);
  gl_FragColor=vec4(uRim*(0.55+a),a*0.85); }`

const models = new Map<string, Promise<GLTF>>()

type Uniforms = {
  uJacket: { value: T.Color }
  uPants: { value: T.Color }
  uGloves: { value: T.Color }
  uBoots: { value: T.Color }
  uSkin: { value: T.Color }
  uRim: { value: T.Color }
  uHolo: { value: number }
  uTime: { value: number }
  uMinY: { value: number }
  uSpanY: { value: number }
  uUp: { value: T.Vector3 }
}

interface Spray {
  pos: Float32Array
  vel: Float32Array
  life: Float32Array
  n: number
  acc: number
  points: T.Points<T.BufferGeometry, T.PointsMaterial>
}

const V3 = (x: number, y: number, z: number) => new T.Vector3(x, y, z)
const cl = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x))
const SIDES = ['Left', 'Right'] as const

export class SkierScene {
  private o: SkierOptions
  private readonly host: HTMLElement
  private readonly reduced: boolean
  private r!: T.WebGLRenderer
  private scene!: T.Scene
  private cam!: T.PerspectiveCamera
  private u!: Uniforms
  private mats: T.MeshPhysicalMaterial[] = []
  private gear!: Record<'helmet' | 'goggle' | 'skis' | 'poles' | 'pack', T.MeshStandardMaterial>
  private model!: T.Object3D
  private root!: T.Group
  private b: Record<string, T.Bone> = {}
  private rest: Record<string, T.Quaternion> = {}
  private mixer!: T.AnimationMixer
  private skis: T.Mesh[] = []
  private poles: T.Group[] = []
  private poleDir: (T.Vector3 | null)[] = [null, null]
  private poleVel = [new T.Vector3(), new T.Vector3()]
  private pack!: T.Mesh
  private padM!: T.ShaderMaterial
  private pad!: T.Mesh
  private ground!: T.Mesh
  private pts!: T.Points<T.BufferGeometry, T.PointsMaterial>
  private seeds: number[] = []
  private spray: Spray | null = null
  private w = { idle: 1, carve: 0, celebrate: 0, sleep: 0 }
  private raf = 0
  private last = 0
  private t0 = performance.now()
  private visible = true
  private dead = false
  private hover = false
  private dragging = false
  private dx = 0
  private yaw = 0
  private yawT = 0
  private tmpQ = new T.Quaternion()
  private e = new T.Euler()
  private cleanup: (() => void)[] = []

  private constructor(host: HTMLElement, o: SkierOptions, reduced: boolean) {
    this.host = host
    this.o = o
    this.reduced = reduced
  }

  /** Build the scene into `host` (a positioned element). Rejects when the body model cannot load. */
  static async create(host: HTMLElement, modelUrl: string, o: SkierOptions, reduced: boolean): Promise<SkierScene> {
    const s = new SkierScene(host, o, reduced)
    if (!models.has(modelUrl)) models.set(modelUrl, new GLTFLoader().loadAsync(modelUrl))
    const gltf = await models.get(modelUrl)!
    s.setup(gltf)
    return s
  }

  setOptions(o: SkierOptions) {
    this.o = o
    this.apply()
  }

  setVisible(v: boolean) {
    this.visible = v
    if (v) this.loop()
  }

  dispose() {
    this.dead = true
    cancelAnimationFrame(this.raf)
    this.cleanup.forEach((f) => f())
    this.r?.dispose()
    this.r?.domElement.remove()
  }

  private listen(el: EventTarget, type: string, fn: (e: PointerEvent) => void) {
    el.addEventListener(type, fn as EventListener)
    this.cleanup.push(() => el.removeEventListener(type, fn as EventListener))
  }

  private material(orig: T.MeshStandardMaterial | undefined): T.MeshPhysicalMaterial {
    const hasMap = !!orig?.map
    const m = new T.MeshPhysicalMaterial({
      color: '#ffffff',
      map: hasMap ? orig!.map : null,
      normalMap: orig?.normalMap ?? null,
      roughness: 0.82,
      metalness: 0,
      sheen: 0.3,
      sheenRoughness: 0.6,
      sheenColor: new T.Color('#6a7c8c'),
      clearcoat: 0.05,
      clearcoatRoughness: 0.7,
    })
    const u = this.u
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u, { uHasMap: { value: hasMap ? 1 : 0 } })
      sh.vertexShader =
        'varying float vZoneY; varying float vZoneX; varying float vWY;\nuniform float uMinY; uniform float uSpanY; uniform float uTime; uniform float uHolo; uniform vec3 uUp;\n' +
        sh.vertexShader
          .replace('#include <begin_vertex>', '#include <begin_vertex>\nvZoneY=(dot(position,uUp)-uMinY)/uSpanY; vZoneX=abs(position.x)/uSpanY;')
          .replace(
            '#include <skinning_vertex>',
            `#include <skinning_vertex>
            vWY = (modelMatrix * vec4(transformed, 1.0)).y;
            float gt = floor(uTime * 7.0); float gr = fract(sin(gt * 12.9898) * 43758.5453);
            if (uHolo > 0.5 && gr > 0.88) { float bnd = step(abs(fract(vWY * 2.6 + gr * 7.0) - 0.5), 0.05); transformed.x += bnd * (gr - 0.94) * 70.0; }`,
          )
      sh.fragmentShader =
        'varying float vZoneY; varying float vZoneX; varying float vWY; uniform vec3 uJacket; uniform vec3 uPants; uniform vec3 uGloves; uniform vec3 uBoots; uniform vec3 uSkin; uniform vec3 uRim; uniform float uHolo; uniform float uTime; uniform float uHasMap;\n' +
        sh.fragmentShader
          .replace(
            '#include <map_fragment>',
            `#include <map_fragment>
            float texLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
            vec3 zc = mix(uPants, uJacket, smoothstep(0.49, 0.515, vZoneY));
            zc = mix(uBoots, zc, smoothstep(0.065, 0.085, vZoneY));
            zc = mix(zc, uGloves, smoothstep(0.35, 0.37, vZoneX) * step(0.6, vZoneY));
            zc = mix(zc, uPants, smoothstep(0.85, 0.86, vZoneY) * (1.0 - uHasMap));
            vec3 cloth = mix(zc, zc * (0.28 + texLum * 1.55), uHasMap);
            float head = smoothstep(0.865, 0.885, vZoneY);
            vec3 headC = mix(uSkin, diffuseColor.rgb, uHasMap);
            diffuseColor.rgb = mix(cloth, headC, head);`,
          )
          .replace(
            '#include <dithering_fragment>',
            `
            vec3 Vd = normalize(vViewPosition); float ndv = abs(dot(normalize(vNormal), Vd)); float fres = pow(1.0 - ndv, 2.2);
            float fine = 0.62 + 0.38 * sin(vWY * 900.0 - uTime * 8.0);
            float band = smoothstep(0.0, 0.035, abs(fract(vWY * 0.7 - uTime * 0.32) - 0.5));
            float flick = 0.93 + 0.07 * sin(uTime * 37.0) * sin(uTime * 13.0);
            float det = mix(0.5, texLum, uHasMap);
            vec3 holo = (uRim * (0.05 + det * 0.45 + fres * 2.0) * fine + uRim * (1.0 - band) * 0.55) * flick;
            float feet = smoothstep(0.0, 0.12, vZoneY);
            gl_FragColor.rgb = mix(gl_FragColor.rgb + uRim * fres * 0.35, holo, uHolo);
            gl_FragColor.a = mix(1.0, clamp(((0.1 + det * 0.3 + fres * 1.4) * fine + (1.0 - band) * 0.45) * feet, 0.0, 1.0), uHolo);
            #include <dithering_fragment>`,
          )
    }
    return m
  }

  private setup(gltf: GLTF) {
    if (this.dead) return
    const r = new T.WebGLRenderer({ antialias: true, alpha: true })
    r.setPixelRatio(Math.min(2, devicePixelRatio || 1))
    r.outputColorSpace = T.SRGBColorSpace
    r.toneMapping = T.ACESFilmicToneMapping
    r.toneMappingExposure = 1.05
    r.shadowMap.enabled = true
    r.shadowMap.type = T.PCFSoftShadowMap
    Object.assign(r.domElement.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block' })
    r.domElement.setAttribute('aria-hidden', 'true')
    this.host.appendChild(r.domElement)
    this.r = r

    const scene = (this.scene = new T.Scene())
    this.cam = new T.PerspectiveCamera(22, 1, 0.1, 60)
    const pm = new T.PMREMGenerator(r)
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture
    scene.environmentIntensity = 0.55
    scene.add(new T.HemisphereLight('#eaf4ff', '#5d6b78', 1.6))
    const key = new T.DirectionalLight('#fff6ea', 2.6)
    key.position.set(2.5, 4.5, 3)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    Object.assign(key.shadow.camera, { left: -1.5, right: 1.5, top: 2.2, bottom: -0.5, near: 0.5, far: 12 })
    key.shadow.radius = 6
    key.shadow.bias = -0.0005
    scene.add(key)
    const ground = new T.Mesh(new T.PlaneGeometry(6, 6), new T.ShadowMaterial({ opacity: 0.16 }))
    ground.rotation.x = -Math.PI / 2
    ground.receiveShadow = true
    scene.add(ground)
    this.ground = ground
    const back = new T.DirectionalLight('#9fd8ff', 1.6)
    back.position.set(-3, 2.5, -3)
    scene.add(back)

    this.u = {
      uJacket: { value: new T.Color('#eef2f6') },
      uPants: { value: new T.Color('#27394a') },
      uGloves: { value: new T.Color('#1b2733') },
      uBoots: { value: new T.Color('#1b2733') },
      uSkin: { value: new T.Color('#c99a7a') },
      uRim: { value: new T.Color('#5ee6ff') },
      uHolo: { value: 0 },
      uTime: { value: 0 },
      uMinY: { value: 0 },
      uSpanY: { value: 1 },
      uUp: { value: new T.Vector3(0, 1, 0) },
    }

    const model = (this.model = SkeletonUtils.clone(gltf.scene))
    const box = new T.Box3()
    model.traverse((o) => {
      if ((o as T.SkinnedMesh).isSkinnedMesh) {
        const g = (o as T.SkinnedMesh).geometry
        g.computeBoundingBox()
        box.union(g.boundingBox!)
      }
    })
    const ext = box.getSize(new T.Vector3())
    const zUp = ext.z > ext.y * 1.05
    this.u.uUp.value.set(0, zUp ? 0 : 1, zUp ? 1 : 0)
    this.u.uMinY.value = zUp ? box.min.z : box.min.y
    this.u.uSpanY.value = zUp ? ext.z : ext.y

    let visor: T.SkinnedMesh | null = null
    model.traverse((o) => {
      const m = o as T.SkinnedMesh
      if (!m.isSkinnedMesh) return
      m.frustumCulled = false
      if (/visor/i.test(m.name)) {
        visor = m
        return
      }
      const mat = this.material(m.material as T.MeshStandardMaterial)
      m.material = mat
      m.castShadow = true
      this.mats.push(mat)
    })
    const root = (this.root = new T.Group())
    root.add(model)
    scene.add(root)
    model.traverse((o) => {
      if ((o as T.Bone).isBone) this.b[o.name.replace(/mixamorig:?/, '')] = o as T.Bone
    })
    for (const k in this.b) this.rest[k] = this.b[k].quaternion.clone()
    this.mixer = new T.AnimationMixer(model)
    const idle = gltf.animations.find((a) => /idle/i.test(a.name))
    if (idle) this.mixer.clipAction(idle).play()

    // Gear.
    const gm = (c: string, rough = 0.35, metal = 0.1) => new T.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal })
    const goggle = new T.MeshPhysicalMaterial({ color: '#0b1520', roughness: 0.05, metalness: 0.6, clearcoat: 1, iridescence: 1, iridescenceIOR: 1.6 })
    this.gear = { helmet: gm('#f4f6f8', 0.25, 0.05), goggle, skis: gm('#13202c', 0.25, 0.3), poles: gm('#aab6c1', 0.2, 0.9), pack: gm('#1c6c9c', 0.6) }
    const head = this.b.Head
    const helmet = new T.Mesh(new T.SphereGeometry(13.5, 40, 24, 0, Math.PI * 2, 0, Math.PI * 0.56), this.gear.helmet)
    helmet.position.set(0, 11, 0.5)
    helmet.scale.set(1, 1.02, 1.12)
    head?.add(helmet)
    const gog = new T.Mesh(new T.CylinderGeometry(12.6, 12.2, 5.2, 40, 1, true, -Math.PI * 0.55, Math.PI * 1.1), goggle)
    gog.position.set(0, 9.2, 2.2)
    gog.scale.set(1, 1, 1.08)
    head?.add(gog)
    const strap = new T.Mesh(new T.CylinderGeometry(13, 13, 2.6, 40, 1, true), gm('#1b2733', 0.7))
    strap.position.set(0, 9.4, 0.6)
    strap.scale.set(1, 1, 1.08)
    head?.add(strap)
    if (visor) {
      ;(visor as T.SkinnedMesh).material = goggle
      gog.visible = false
      strap.visible = false
      helmet.position.set(0, 11.2, -0.6)
      helmet.scale.set(0.9, 0.86, 0.98)
    }
    const skiG = new T.BoxGeometry(0.09, 0.018, 1.62, 1, 1, 48)
    const sp = skiG.attributes.position
    for (let i = 0; i < sp.count; i++) {
      const z = sp.getZ(i)
      const tip = Math.max(0, (z - 0.58) / 0.23)
      const tail = Math.max(0, (-z - 0.66) / 0.15)
      sp.setY(i, sp.getY(i) + tip * tip * 0.07 + tail * tail * 0.025)
    }
    skiG.computeVertexNormals()
    this.skis = [new T.Mesh(skiG, this.gear.skis), new T.Mesh(skiG, this.gear.skis)]
    this.skis.forEach((s) => root.add(s))
    const poleG = new T.CylinderGeometry(0.0085, 0.006, 1.15, 12)
    poleG.translate(0, -0.575 + 0.07, 0)
    const gripG = new T.CylinderGeometry(0.016, 0.014, 0.15, 16)
    const gripM = gm('#1b2733', 0.6)
    const basket = new T.Mesh(new T.TorusGeometry(0.045, 0.007, 8, 20), this.gear.poles)
    basket.rotation.x = Math.PI / 2
    basket.position.y = -1.0
    this.poles = [0, 1].map(() => {
      const g = new T.Group()
      g.add(new T.Mesh(poleG, this.gear.poles), new T.Mesh(gripG, gripM), basket.clone())
      root.add(g)
      return g
    })
    this.pack = new T.Mesh(new T.BoxGeometry(26, 36, 13, 2, 2, 2), this.gear.pack)
    this.pack.position.set(0, 4, -16)
    this.b.Spine2?.add(this.pack)

    // Pad + snow aura.
    this.padM = new T.ShaderMaterial({ vertexShader: PAD_VS, fragmentShader: PAD_FS, transparent: true, depthWrite: false, uniforms: { uRim: { value: new T.Color('#5ee6ff') }, uTime: { value: 0 } } })
    this.pad = new T.Mesh(new T.PlaneGeometry(2.1, 2.1), this.padM)
    this.pad.rotation.x = -Math.PI / 2
    this.pad.position.y = 0.002
    scene.add(this.pad)
    const N = 200
    const arr = new Float32Array(N * 3)
    for (let i = 0; i < N; i++) {
      const a = Math.random() * 6.283
      const rr = 0.4 + Math.random() * 0.8
      arr[i * 3] = Math.cos(a) * rr
      arr[i * 3 + 1] = Math.random() * 2.2
      arr[i * 3 + 2] = Math.sin(a) * rr
      this.seeds.push(0.1 + Math.random() * 0.25)
    }
    const pg = new T.BufferGeometry()
    pg.setAttribute('position', new T.BufferAttribute(arr, 3))
    this.pts = new T.Points(pg, new T.PointsMaterial({ color: '#5ee6ff', size: 0.016, transparent: true, opacity: 0.7, depthWrite: false }))
    scene.add(this.pts)
    root.traverse((o) => {
      if ((o as T.Mesh).isMesh) o.castShadow = true
    })

    // Input: hover carves; optional drag turns.
    this.listen(this.host, 'pointerenter', () => (this.hover = true))
    this.listen(this.host, 'pointerleave', () => {
      this.hover = false
      this.dragging = false
    })
    this.listen(this.host, 'pointerdown', (e) => {
      if (this.o.drag) {
        this.dragging = true
        this.dx = e.clientX
      }
    })
    this.listen(window, 'pointerup', () => (this.dragging = false))
    this.listen(this.host, 'pointermove', (e) => {
      if (this.dragging) {
        this.yawT += (e.clientX - this.dx) * 0.012
        this.dx = e.clientX
      }
    })
    this.listen(document, 'visibilitychange', () => {
      if (!document.hidden) this.loop()
    })
    const ro = new ResizeObserver(() => this.resize())
    ro.observe(this.host)
    this.cleanup.push(() => ro.disconnect())

    this.apply()
    this.resize()
    this.t0 = performance.now()
    this.loop()
  }

  private apply() {
    if (!this.u) return
    const o = this.o
    const u = this.u
    u.uJacket.value.set(o.jacket)
    u.uPants.value.set(o.pants)
    u.uGloves.value.set(o.gloves)
    u.uBoots.value.set(o.boots)
    u.uSkin.value.set(o.skin)
    u.uRim.value.set(o.rim)
    this.gear.helmet.color.set(o.helmet)
    this.gear.skis.color.set(o.skis)
    const holo = o.look === 'holo'
    u.uHolo.value = holo ? 1 : 0
    this.ground.visible = !holo
    for (const m of this.mats) {
      m.transparent = holo
      m.depthWrite = true
      m.blending = holo ? T.AdditiveBlending : T.NormalBlending
      m.needsUpdate = true
    }
    for (const m of Object.values(this.gear)) {
      m.transparent = holo
      m.opacity = holo ? 0.35 : 1
      m.emissive.set(holo ? u.uRim.value : '#000000')
      m.emissiveIntensity = holo ? 0.6 : 0
      m.depthWrite = !holo
      m.blending = holo ? T.AdditiveBlending : T.NormalBlending
    }
    ;(this.padM.uniforms.uRim.value as T.Color).copy(u.uRim.value)
    this.pts.material.color.copy(u.uRim.value)
    this.pad.visible = o.pad
    this.pack.visible = o.backpack
    this.poles.forEach((p) => (p.visible = o.poles))
    if (this.reduced || !this.raf) this.frame(0, true)
  }

  private resize() {
    if (!this.r) return
    const w = this.host.clientWidth || 300
    const h = this.host.clientHeight || 300
    this.r.setSize(w, h, false)
    this.cam.aspect = w / h
    this.cam.updateProjectionMatrix()
    this.frame(0, true)
  }

  private loop() {
    cancelAnimationFrame(this.raf)
    if (this.reduced) {
      this.frame(0, true)
      return
    }
    this.last = performance.now()
    const tick = (now: number) => {
      if (this.dead || !this.visible || document.hidden) {
        this.raf = 0
        return
      }
      const dt = Math.min(0.05, (now - this.last) / 1000)
      this.last = now
      this.frame(dt)
      this.raf = requestAnimationFrame(tick)
    }
    this.raf = requestAnimationFrame(tick)
  }

  private rot(name: string, x: number, y: number, z: number) {
    const b = this.b[name]
    if (!b) return
    this.e.set(x, y, z, 'XYZ')
    this.tmpQ.setFromEuler(this.e)
    b.quaternion.multiply(this.tmpQ)
  }

  /** Turn bone `name` so the direction to its child points along `dir` (world space). */
  private aim(name: string, child: string, dir: T.Vector3) {
    const b = this.b[name]
    const c = this.b[child]
    if (!b || !c || !b.parent) return
    b.updateWorldMatrix(true, true)
    const bp = b.getWorldPosition(new T.Vector3())
    const cp = c.getWorldPosition(new T.Vector3())
    const q = new T.Quaternion().setFromUnitVectors(cp.sub(bp).normalize(), dir.normalize())
    const bw = b.getWorldQuaternion(new T.Quaternion())
    const pw = b.parent.getWorldQuaternion(new T.Quaternion()).invert()
    b.quaternion.copy(pw.multiply(q).multiply(bw))
  }

  private frame(dt: number, still = false) {
    if (!this.r) return
    dt = dt || 0.016
    const t = still ? 2.0 : (performance.now() - this.t0) / 1000
    let st: SkierState = this.o.state
    if (st === 'auto') st = this.hover ? 'carve' : t % 17 > 9.5 ? 'carve' : 'idle'
    if (this.reduced && st !== 'sleep') st = 'idle'
    const w = this.w
    const k = still ? 1 : Math.min(1, dt * 2.4)
    for (const n of Object.keys(w) as (keyof typeof w)[]) w[n] += ((n === st ? 1 : 0) - w[n]) * k
    for (const bn in this.b) this.b[bn].quaternion.copy(this.rest[bn])
    this.mixer.update(still ? 0.0001 : dt)
    const { idle: wi, carve: wc, celebrate: we, sleep: ws } = w
    const tp = t * 1.3
    const turn = Math.sin(tp)
    const turnV = Math.cos(tp)
    const breath = Math.sin(t * (ws > 0.5 ? 0.9 : 1.7))
    const shift = Math.sin(t * 0.55) * wi
    const lookY = (Math.sin(t * 0.31) + 0.6 * Math.sin(t * 0.83 + 1.7)) * 0.3 * wi + turnV * 0.3 * wc
    const lookP = Math.sin(t * 0.47 + 0.4) * 0.07 * wi
    const g = t % 7.5
    const tap = wi * (g > 5.4 && g < 6.6 ? Math.sin(((g - 5.4) / 1.2) * Math.PI) : 0)
    const bt = t % 11
    const bounce = wi * (bt > 2 && bt < 3.2 ? Math.abs(Math.sin((bt - 2) * Math.PI * 2.5)) : 0)
    const hop = Math.max(0, Math.sin(t * 3.4))
    const root = this.root
    this.yaw += (this.yawT - this.yaw) * Math.min(1, dt * 6)
    root.rotation.set(0, this.yaw + turnV * 0.34 * wc + shift * 0.05 + (we ? Math.sin(t * 1.7) * 0.15 * we : 0), -turn * 0.44 * wc)
    root.position.set(turn * 0.16 * wc + shift * 0.02, 0, 0)
    root.updateMatrixWorld(true)
    const rq = root.getWorldQuaternion(new T.Quaternion())
    const aimR = (bn: string, cn: string, v: T.Vector3) => this.aim(bn, cn, v.applyQuaternion(rq))
    const f = cl(0.45 + 0.04 * breath * wi + 0.28 * bounce + 0.28 * wc + 0.12 * Math.abs(turnV) * wc + 0.45 * ws - 0.35 * we)
    const ang = turn * wc * 0.55
    const LN = 0.22 + 0.32 * f + 0.025 * breath
    aimR('Spine', 'Spine1', V3(ang * 0.5 + shift * 0.05, Math.cos(LN * 0.8), Math.sin(LN * 0.8)))
    this.rot('Spine', 0, -turnV * 0.18 * wc, 0)
    aimR('Spine1', 'Spine2', V3(ang * 0.75, Math.cos(LN), Math.sin(LN)))
    this.rot('Spine1', 0, -turnV * 0.14 * wc, 0)
    aimR('Spine2', 'Neck', V3(ang * 0.9, Math.cos(LN * 1.1), Math.sin(LN * 1.1)))
    aimR('Neck', 'Head', V3(ang * 0.7, Math.cos(LN * 0.45 + ws * 0.7), Math.sin(LN * 0.45 + ws * 0.7)))
    const hp = -0.05 + ws * 0.5 - we * 0.3 + lookP
    aimR('Head', 'HeadTop_End', V3(ang * 0.4, Math.cos(hp), Math.sin(hp)))
    this.rot('Head', 0, lookY, 0)
    const th = 0.52 + 0.8 * f
    const sh = 0.36 + 0.45 * f
    for (const sd of SIDES) {
      const sg = sd === 'Left' ? 1 : -1
      const outside = sg * turn * wc
      const ths = th - outside * 0.22 + sg * shift * 0.12
      const shs = sh - outside * 0.14 + sg * shift * 0.08
      aimR(sd + 'UpLeg', sd + 'Leg', V3(sg * 0.04 + turn * wc * 0.34, -Math.cos(ths), Math.sin(ths)))
      aimR(sd + 'Leg', sd + 'Foot', V3(sg * 0.01 + turn * wc * 0.14, -Math.cos(shs), -Math.sin(shs)))
      aimR(sd + 'Foot', sd + 'ToeBase', V3(0, -0.12, 1))
    }
    const model = this.model
    model.position.set(0, 0, 0)
    model.updateMatrixWorld(true)
    const footL = this.b.LeftFoot
    const footR = this.b.RightFoot
    if (footL && footR) {
      const lf = root.worldToLocal(footL.getWorldPosition(new T.Vector3()))
      const rf = root.worldToLocal(footR.getWorldPosition(new T.Vector3()))
      model.position.set(-(lf.x + rf.x) / 2, -Math.min(lf.y, rf.y) + 0.1 + we * hop * 0.24, -(lf.z + rf.z) / 2 + 0.05)
    }
    model.updateMatrixWorld(true)
    const mixv = (a: T.Vector3, b: T.Vector3, c: T.Vector3) =>
      V3(a.x * (wi + wc) + b.x * we + c.x * ws, a.y * (wi + wc) + b.y * we + c.y * ws, a.z * (wi + wc) + b.z * we + c.z * ws)
    const plant = [0, 0]
    SIDES.forEach((sd, i) => {
      const sg = i === 0 ? 1 : -1
      const cv = turn * wc * 0.16 * sg
      plant[i] = wc * cl((turnV * sg - 0.55) / 0.45)
      const tp2 = sg < 0 ? tap : 0
      let up = mixv(V3(sg * 0.32, -0.78 + cv - plant[i] * 0.1, 0.52 + plant[i] * 0.25), V3(sg * 0.5, 0.86, 0.08 + 0.05 * Math.sin(t * 5)), V3(sg * 0.12, -1, 0.2))
      let fo = mixv(V3(sg * 0.12, -0.32 + cv - plant[i] * 0.15, 1), V3(sg * 0.25, 1, 0.12), V3(sg * 0.05, -0.6, 0.8))
      if (tp2) {
        up = up.lerp(V3(sg * 0.28, -0.35, 0.9), tp2)
        fo = fo.lerp(V3(sg * 0.1, 0.25, 1), tp2)
      }
      this.aim(sd + 'Arm', sd + 'ForeArm', up.applyQuaternion(rq))
      this.aim(sd + 'ForeArm', sd + 'Hand', fo.applyQuaternion(rq))
    })
    for (const sd of SIDES) {
      const hb = this.b[sd + 'Hand']
      const fb = this.b[sd + 'ForeArm']
      if (!hb || !fb) continue
      const base = hb.getWorldPosition(new T.Vector3()).sub(fb.getWorldPosition(new T.Vector3())).normalize()
      const axis = new T.Vector3().crossVectors(base, V3(0, 1, 0).applyQuaternion(rq)).normalize()
      if (!Number.isFinite(axis.x)) continue
      for (const fn of ['Index', 'Middle', 'Ring', 'Pinky'])
        for (let j = 1; j <= 3; j++) this.aim(sd + 'Hand' + fn + j, sd + 'Hand' + fn + (j + 1), base.clone().applyAxisAngle(axis, -[1.05, 2.1, 2.9][j - 1] * (1 - we * 0.6)))
    }
    model.updateMatrixWorld(true)
    ;[this.b.LeftFoot, this.b.RightFoot].forEach((b, i) => {
      if (!b) return
      const p = root.worldToLocal(b.getWorldPosition(new T.Vector3()))
      this.skis[i].position.set(p.x, p.y - 0.085, p.z + 0.06)
    })
    const PL = 1.08
    SIDES.forEach((sd, i) => {
      const sg = i ? -1 : 1
      const p = this.poles[i]
      const wp = (n: string) => (this.b[sd + n] ? root.worldToLocal(this.b[sd + n].getWorldPosition(new T.Vector3())) : null)
      const hand = wp('Hand')
      if (!hand) return
      const i1 = wp('HandIndex1') ?? hand
      const p1 = wp('HandPinky1') ?? hand
      const m2 = wp('HandMiddle2') ?? hand
      const grip = hand.clone().multiplyScalar(0.25).add(i1.clone().multiplyScalar(0.25)).add(p1.clone().multiplyScalar(0.25)).add(m2.clone().multiplyScalar(0.25))
      const tapI = i === 1 ? tap : 0
      let target: T.Vector3
      if (we > 0.5) target = V3(sg * 0.35, 1, -0.15).normalize()
      else {
        let hx = sg * 0.14
        let hz = -0.34 + plant[i] * 1.1 + tapI * 0.9
        const hl = Math.hypot(hx, hz) || 1
        hx /= hl
        hz /= hl
        const dy = grip.y - 0.025 + tapI * 0.1 * Math.abs(Math.sin(t * 9))
        const hd = dy < PL ? Math.sqrt(PL * PL - dy * dy) : 0
        target = V3(hx * hd, -Math.min(dy, PL), hz * hd).normalize()
      }
      let dir = this.poleDir[i]
      if (!dir || still) dir = this.poleDir[i] = target.clone()
      else {
        const vel = this.poleVel[i]
        const acc = target.clone().sub(dir).multiplyScalar(160).sub(vel.clone().multiplyScalar(17))
        vel.addScaledVector(acc, dt)
        dir.addScaledVector(vel, dt).normalize()
      }
      if (grip.y + dir.y * PL < 0.02 && we < 0.5) {
        const dy = grip.y - 0.02
        const hlen = Math.hypot(dir.x, dir.z) || 1
        const hd = Math.sqrt(Math.max(0, PL * PL - dy * dy))
        dir.set((dir.x / hlen) * hd, -dy, (dir.z / hlen) * hd).normalize()
      }
      p.position.copy(grip)
      p.quaternion.setFromUnitVectors(V3(0, -1, 0), dir)
    })

    // Snow spray off the outside ski while carving.
    if (!this.spray) {
      const N = 180
      const gg = new T.BufferGeometry()
      const pos = new Float32Array(N * 3)
      for (let i = 0; i < N; i++) pos[i * 3 + 1] = -9
      gg.setAttribute('position', new T.BufferAttribute(pos, 3))
      const points = new T.Points(gg, new T.PointsMaterial({ color: '#ffffff', size: 0.028, transparent: true, opacity: 0.9, depthWrite: false }))
      this.scene.add(points)
      this.spray = { pos, vel: new Float32Array(N * 3), life: new Float32Array(N), n: N, acc: 0, points }
    }
    if (!still) {
      const S = this.spray
      S.acc += wc * Math.abs(turn) * 220 * dt
      const oi = turn > 0 ? 0 : 1
      const tail = this.skis[oi].localToWorld(V3(0, 0.02, -0.7))
      const out = V3(Math.sign(turn) * -1, 0, 0).applyQuaternion(rq)
      for (let i = 0; i < S.n && S.acc >= 1; i++)
        if (S.life[i] <= 0) {
          S.acc -= 1
          S.life[i] = 0.5 + Math.random() * 0.5
          S.pos[i * 3] = tail.x + (Math.random() - 0.5) * 0.2
          S.pos[i * 3 + 1] = tail.y
          S.pos[i * 3 + 2] = tail.z + (Math.random() - 0.5) * 0.5
          const spd = 0.8 + Math.random() * 1.4
          S.vel[i * 3] = out.x * spd
          S.vel[i * 3 + 1] = 0.6 + Math.random() * 1.3
          S.vel[i * 3 + 2] = out.z * spd - 0.8
        }
      for (let i = 0; i < S.n; i++) {
        if (S.life[i] <= 0) continue
        S.life[i] -= dt
        S.vel[i * 3 + 1] -= 4.2 * dt
        S.pos[i * 3] += S.vel[i * 3] * dt
        S.pos[i * 3 + 1] += S.vel[i * 3 + 1] * dt
        S.pos[i * 3 + 2] += S.vel[i * 3 + 2] * dt
        if (S.life[i] <= 0 || S.pos[i * 3 + 1] < 0) {
          S.life[i] = 0
          S.pos[i * 3 + 1] = -9
        }
      }
      S.points.geometry.attributes.position.needsUpdate = true
      S.points.material.color.copy(this.u.uHolo.value ? this.u.uRim.value : new T.Color('#ffffff'))
    }
    this.u.uTime.value = t
    this.padM.uniforms.uTime.value = t
    if (!still) {
      const pa = this.pts.geometry.attributes.position
      for (let i = 0; i < pa.count; i++) {
        let y = pa.getY(i) - this.seeds[i] * dt * (1 + wc * 2)
        if (y < 0) y += 2.2
        pa.setY(i, y)
        let z = pa.getZ(i) - wc * 2.6 * dt
        if (z < -1.2) z += 2.4
        pa.setZ(i, z)
      }
      pa.needsUpdate = true
    }
    const cam = this.cam
    const ca = 0.55 + 0.16 * Math.sin(t * 0.13)
    const cd = this.o.distance * 1.2 * (1 - 0.05 * wc)
    cam.position.set(Math.sin(ca) * cd + root.position.x * 0.4, 1.3 + 0.06 * Math.sin(t * 0.21), Math.cos(ca) * cd)
    cam.lookAt(root.position.x * 0.6, 0.86, 0)
    this.r.render(this.scene, cam)
  }
}
