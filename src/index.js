'use strict';

let renderer, camera, controller, scene;
let world;
let lastTime;
const updateObjects = [];
const pairs = []

const Scale = 20; // 全体のスケール感 (1/scale)
const ChainCount = 15; // チェーンを構成するSphereの数
const PairCount = 5; // チェーンと鉄球の組の数
const LastPairXAngle = 50; // 最後に生成する組のX軸方向角度(°)

const ChainRadius = 1 / Scale; // チェーンを構成する1つのSphereの半径(m)
const ChainMass = 1 / Scale; // チェーンを構成する1つのSphereの重さ(kg)

const ChainZGap = 1 / Scale; // チェーンのZ軸方向のずらし距離(m)

const IronSphereRadiusScale = 5; // 鉄球のスケール(ChainRadiusに対する)
const IronSphereMassScale = 10; // 鉄球のスケール(ChainMassに対する)

const PairSpace = ChainRadius * IronSphereRadiusScale * 2; // 組同士の距離 (m)

window.addEventListener('DOMContentLoaded', init);
window.addEventListener('resize', onResize);

/**
 * 初期化処理
 */
function init() {
  // レンダラーの生成
  renderer = new THREE.WebGLRenderer({
    antialias: true,
  });
  renderer.shadowMap.enabled = true;
  document.body.appendChild(renderer.domElement); // レンダラー(Canvas)をDOMへ追加

  // カメラの生成
  camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight);
  camera.position.set(-2, 3.5, 3.5); // 適当に位置調整(x,y,z)
  camera.lookAt(0, 1.5, 0);

  // シーンの生成
  scene = new THREE.Scene();

  // スポットライト 
  const spotLight = new THREE.SpotLight(0xffffff, 1.5);
  spotLight.position.set(3, 3, 3); // 適当に位置調整(x,y,z)
  spotLight.lookAt(new THREE.Vector3(0, 0, 0));
  spotLight.castShadow = true;
  spotLight.shadow.mapSize.width = 2048;
  spotLight.shadow.mapSize.height = 2048;
  scene.add(spotLight);

  // 環境光源
  const ambient = new THREE.AmbientLight(0xffffff, 1.0);
  scene.add(ambient);

  world = new CANNON.World(); // 物理世界の取得
  world.broadphase = new CANNON.NaiveBroadphase(); //衝突した物体を検出するためのオブジェクト
  world.solver.iterations = 10; // 正確さを増すための反復計算回数
  world.solver.tolerance = 0.1; // 計算結果の不正確さの許容値
  world.gravity.set(0, -9.82, 0); // m/s² // x y z それぞれにかかる力（重力）を設定

  // 床を生成(見た目だけで物理演算には関係なし)
  const groundmesh = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshStandardMaterial({
      color: 0x222222,
      side: THREE.DoubleSide,
    }),
  );
  groundmesh.rotation.set(Math.PI / 2, 0, 0);
  groundmesh.receiveShadow = true;
  scene.add(groundmesh);

  // フレームを作成(見た目だけで物理演算には関係なし)
  const frame1 = new THREE.Mesh(
    new THREE.BoxGeometry(3, 0.1, 0.1), // 適当に位置調整(x,y,z)
    new THREE.MeshStandardMaterial({
      color: 0x666666,
      side: THREE.DoubleSide,
    }),
  );
  frame1.position.set(-0.2, 2.5, 0.75);
  scene.add(frame1);

  let frame2 = frame1.clone();
  frame2.position.z = -frame2.position.z;
  scene.add(frame2);

  // チェーンと鉄球の組を生成
  for (let i = 0; i < PairCount; i++) {
    addPair(
      new CANNON.Vec3((PairSpace * i) - (PairSpace * PairCount / 2), 2.5, 0),
      i === PairCount - 1 ? LastPairXAngle : 0);
  }

  // 鉄球同士が衝突したときの影響を設定
  pairs.forEach((pair, idx) => {
    if (idx === 0) {
      return;
    }
    let contact = new CANNON.ContactMaterial(
      pairs[idx - 1].ironSphere.body.material, //ひとつ目のマテリアル
      pair.ironSphere.body.material, //ふたつ目のマテリアル
      {
        contactEquationRelaxation: 3, // 接触式の緩和性
        friction: 0.1, //摩擦係数
        frictionEquationRelaxation: 3, // 摩擦式の剛性
        restitution: 0.9 // 反発係数
      }
    );
    world.addContactMaterial(contact);
  });

  scene.add(new THREE.AxesHelper(1000));

  tick();
  onResize();
}

/**
 * チェーンと鉄球の組を生成して追加する
 * @param {CANNON.Vec3} origin 基準点(チェーンの始点)
 * @param {number} xAngle X角度(°)
 */
function addPair(origin, xAngle) {
  const space = ChainZGap * ChainCount;
  let chain1 =
    createChain(new CANNON.Vec3(origin.x, origin.y, origin.z + space), xAngle, -ChainZGap);
  let chain2 =
    createChain(new CANNON.Vec3(origin.x, origin.y, origin.z - space), xAngle, ChainZGap);

  const size = ChainRadius * IronSphereRadiusScale;
  const mass = ChainMass * IronSphereMassScale;

  for (let i = 0; i < chain1.length; i++) {
    // 対向のチェーンと接続
    world.addConstraint(new CANNON.DistanceConstraint(chain1[i].body, chain2[i].body));
  }

  let lastChainSphereY = chain1[chain1.length - 1].body.position.y; // チェーンの一番下のsphere
  let ironSphereY = lastChainSphereY - ChainRadius - size;

  const radius = lastChainSphereY - ironSphereY;
  const rad = (xAngle - 90) * (Math.PI / 180);
  const x = chain1[chain1.length - 1].body.position.x + radius * Math.cos(rad);
  const y = chain1[chain1.length - 1].body.position.y + radius * Math.sin(rad);

  let ironSphere = createSphere(new CANNON.Vec3(x, y, origin.z), size, mass);
  world.addBody(ironSphere.body);
  scene.add(ironSphere.mesh);
  updateObjects.push({
    mesh: ironSphere.mesh,
    body: ironSphere.body
  });

  world.addConstraint(new CANNON.DistanceConstraint(chain1[chain1.length - 1].body, ironSphere.body));
  world.addConstraint(new CANNON.DistanceConstraint(chain2[chain2.length - 1].body, ironSphere.body));

  pairs.push({
    chain1: chain1,
    chain2: chain2,
    ironSphere: ironSphere
  });
}

/**
 * チェーンを生成する
 * @param {CANNON.Vec3} origin 基準点(チェーンの始点)
 * @param {number} xAngle X角度(°)
 * @param {number} zGap Z軸ずらし距離(m)
 */
function createChain(origin, xAngle, zGap) {
  const chains = [];
  const dist = ChainRadius * 2;
  let lastBody = null;
  world.solver.iterations = ChainCount;
  for (var i = 0; i < ChainCount; i++) {
    let sphere = null;
    const mass = i === 0 ? 0 : ChainMass;
    const radius = i * dist;
    const rad = (xAngle - 90) * (Math.PI / 180);
    const x = origin.x + radius * Math.cos(rad);
    const y = origin.y + radius * Math.sin(rad);
    const z = origin.z + (i * zGap);

    sphere = createSphere(new CANNON.Vec3(x, y, z), ChainRadius, mass);
    world.addBody(sphere.body);
    scene.add(sphere.mesh);

    updateObjects.push({
      mesh: sphere.mesh,
      body: sphere.body
    });

    chains.push({
      mesh: sphere.mesh,
      body: sphere.body
    });

    if (lastBody !== null) {
      world.addConstraint(new CANNON.DistanceConstraint(sphere.body, lastBody));
    }

    lastBody = sphere.body;
  }

  return chains;
}

function createSphere(pos, radius, mass) {
  const mat = new CANNON.Material('SphereMat');
  const body = new CANNON.Body({
    mass: mass, // kg
    position: pos, // m
    shape: new CANNON.Sphere(radius),
    material: mat,
    angularDamping: 0.1,
    velocity: new CANNON.Vec3(0, 0, 0),
  })

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 8, 8),
    new THREE.MeshStandardMaterial({
      color: 0x777777,
      roughness: 0.5,
    }),
  );
  mesh.castShadow = true;
  mesh.position.copy(body.position)

  return {
    body,
    mesh
  }
}

function tick(time) {
  updateObjects.forEach(chain => {
    chain.mesh.position.copy(chain.body.position)
    chain.mesh.quaternion.copy(chain.body.quaternion)
  })

  renderer.render(scene, camera);
  requestAnimationFrame(tick);

  if (lastTime !== undefined) {
    const fixedTimeStep = 1.0 / 60.0; // seconds
    const maxSubSteps = 3;
    const dt = (time - lastTime) / 1000;
    world.step(fixedTimeStep, dt, maxSubSteps);
  }
  lastTime = time;
}

function onResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(width, height);

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}