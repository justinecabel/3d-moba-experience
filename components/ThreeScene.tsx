
import React, { useRef, useEffect, useMemo, useCallback } from 'react';
import * as THREE from 'three';
import type { JoystickOutput } from '../types';

const PLAYER_ATTACK_EFFECT_DURATION = 0.3; // seconds for player's own attack visual
const CHARACTER_BASE_Y = (0.8 / 2) + 0.4; // Capsule radius + half height
const MIN_CAMERA_Y_POSITION = 0.5; // Minimum Y position for the camera itself

const ENEMY_MOVE_SPEED = 3.2; // Slightly increased
const ENEMY_ROTATION_SPEED = Math.PI * 1.8; // Slightly increased
const ENEMY_ROAM_TARGET_UPDATE_MIN_INTERVAL = 4; // seconds
const ENEMY_ROAM_TARGET_UPDATE_MAX_INTERVAL = 8; // seconds
const ENEMY_TARGET_REACH_THRESHOLD = 0.5; // units

// New Enemy AI Constants
const ENEMY_DETECTION_RANGE_SQR = (50 * 0.45) ** 2; // Using squared distance for efficiency
const ENEMY_ATTACK_RANGE_SQR = (2.2) ** 2; // Using squared distance
const ENEMY_ATTACK_COOLDOWN = 2.5; // seconds
const ENEMY_ATTACK_EFFECT_DURATION = 0.45; // seconds
const TOWER_AVOIDANCE_RANGE_ENEMY_SQR = (50 * 0.20) ** 2; // How close enemy gets before fleeing a hostile tower (squared)
const FLEE_DISTANCE_FROM_TOWER = 50 * 0.1;


// --- Math & Utility Functions ---
const shortestAngleDiff = (current: number, target: number): number => {
  const M2PI = Math.PI * 2;
  let d = (target - current) % M2PI;
  if (d > Math.PI) d -= M2PI;
  else if (d < -Math.PI) d += M2PI;
  return d;
};

const shuffleArray: (<T>(array: T[]) => T[]) = (array) => {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
};

const getRandomRoamTarget = (mapRadius: number, currentPos: THREE.Vector3, blueFountainPos: THREE.Vector3, redFountainPos: THREE.Vector3): THREE.Vector3 => {
    let x, z;
    const boundary = mapRadius * 0.95;
    const blueBaseAvoidRadius = mapRadius * 0.3; 
    const redBaseAvoidRadius = mapRadius * 0.2; // Avoid its own fountain too much

    for (let i = 0; i < 10; i++) { 
        x = (Math.random() - 0.5) * 2 * boundary;
        z = (Math.random() - 0.5) * 2 * boundary;
        
        const targetPos = new THREE.Vector3(x, 0, z);
        if (targetPos.lengthSq() > boundary * boundary) continue;
        if (targetPos.distanceToSquared(blueFountainPos) < blueBaseAvoidRadius * blueBaseAvoidRadius && currentPos.z > 0) continue;
        if (targetPos.distanceToSquared(redFountainPos) < redBaseAvoidRadius * redBaseAvoidRadius ) continue;

        return targetPos;
    }
    return new THREE.Vector3((Math.random() - 0.5) * boundary, 0, (Math.random() - 0.5) * boundary);
};


// --- 3D Object Creation Functions ---
const createCharacterMesh = (color: THREE.Color, name: string): THREE.Mesh => {
    const geometry = new THREE.CapsuleGeometry(0.4, 0.8, 4, 16); 
    const material = new THREE.MeshStandardMaterial({ color: color.getHex(), roughness: 0.4, metalness: 0.2 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = true;
    mesh.position.y = CHARACTER_BASE_Y;
    return mesh;
};

const createTower = (position: THREE.Vector3, teamColorHex = 0x5555ff, name = 'tower', isBaseTower = false): THREE.Group => {
  const towerGroup = new THREE.Group();
  towerGroup.name = name;
  const baseHeight = isBaseTower ? 3.5 : 2.8;
  const baseRadius = isBaseTower ? 1.8 : 1.4;
  const baseMaterialColor = new THREE.Color(0x4a5568);
  if (!isBaseTower) baseMaterialColor.lerp(new THREE.Color(teamColorHex), 0.3);
  else baseMaterialColor.lerp(new THREE.Color(teamColorHex), 0.15);
  const baseGeometry = new THREE.CylinderGeometry(baseRadius, baseRadius * 1.2, baseHeight, 16);
  const baseMaterial = new THREE.MeshStandardMaterial({ color: baseMaterialColor, roughness: 0.6, metalness: 0.3 });
  const baseMesh = new THREE.Mesh(baseGeometry, baseMaterial);
  baseMesh.castShadow = true; baseMesh.receiveShadow = true;
  baseMesh.position.y = baseHeight / 2; towerGroup.add(baseMesh);
  const topHeight = isBaseTower ? 2.5 : 2.0;
  const topRadius = isBaseTower ? 1.0 : 0.8;
  const topGeometry = new THREE.CylinderGeometry(topRadius * 0.8, topRadius, topHeight, 12);
  const topMaterial = new THREE.MeshStandardMaterial({ color: teamColorHex, roughness: 0.5, metalness: 0.4 });
  const topMesh = new THREE.Mesh(topGeometry, topMaterial);
  topMesh.castShadow = true; topMesh.position.y = baseHeight + topHeight / 2; towerGroup.add(topMesh);
  const crystalSize = isBaseTower ? 0.8 : 0.6;
  const crystalGeometry = new THREE.OctahedronGeometry(crystalSize, 0);
  const crystalMaterial = new THREE.MeshStandardMaterial({color: teamColorHex, emissive: teamColorHex, emissiveIntensity: 0.7, roughness:0.2, metalness: 0.1 });
  const crystalMesh = new THREE.Mesh(crystalGeometry, crystalMaterial);
  crystalMesh.position.y = baseHeight + topHeight + crystalSize * 0.8; towerGroup.add(crystalMesh);
  towerGroup.position.copy(position); return towerGroup;
};

const createTree = (position: THREE.Vector3): THREE.Group => {
    const treeGroup = new THREE.Group(); const trunkHeight = 1.5 + Math.random() * 0.5;
    const trunkRadius = 0.2 + Math.random() * 0.1;
    const trunkGeometry = new THREE.CylinderGeometry(trunkRadius*0.8, trunkRadius, trunkHeight, 8);
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x785548 });
    const trunkMesh = new THREE.Mesh(trunkGeometry, trunkMaterial);
    trunkMesh.castShadow = true; trunkMesh.position.y = trunkHeight / 2; treeGroup.add(trunkMesh);
    const foliageLevels = 2 + Math.floor(Math.random() * 2);
    const foliageBaseRadius = 1.0 + Math.random() * 0.4;
    const foliageBaseHeight = 1.2 + Math.random() * 0.6;
    const foliageMaterial = new THREE.MeshStandardMaterial({ color: 0x228B22, roughness: 0.8 });
    for (let i = 0; i < foliageLevels; i++) {
        const levelRadius = foliageBaseRadius * (1 - i * 0.25);
        const levelHeight = foliageBaseHeight * (1 - i * 0.2);
        const foliageGeometry = new THREE.ConeGeometry(levelRadius, levelHeight, 8);
        const foliageMesh = new THREE.Mesh(foliageGeometry, foliageMaterial);
        foliageMesh.castShadow = true;
        foliageMesh.position.y = trunkHeight + i * (levelHeight * 0.35) + levelHeight * 0.3;
        treeGroup.add(foliageMesh);
    }
    treeGroup.position.copy(position); treeGroup.rotation.y = Math.random() * Math.PI * 2; return treeGroup;
};

const createJungleMonsterPlaceholder = (position: THREE.Vector3, teamColor = 0xaaaaaa): THREE.Group => {
    const monsterGroup = new THREE.Group(); const bodySize = 0.8 + Math.random() * 0.4;
    const bodyMaterial = new THREE.MeshStandardMaterial({ color: teamColor, roughness: 0.7, metalness: 0.2 });
    const bodyGeometry = new THREE.DodecahedronGeometry(bodySize / 1.8, 0);
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.castShadow = true; body.position.y = bodySize / 1.8; monsterGroup.add(body);
    for (let i = 0; i < 2 + Math.floor(Math.random()*2) ; i++) {
        const spikeSize = bodySize * (0.15 + Math.random() * 0.1);
        const spikeGeometry = new THREE.ConeGeometry(spikeSize / 2, spikeSize * 2, 4);
        const spikeMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor).offsetHSL(0, 0, -0.2) });
        const spike = new THREE.Mesh(spikeGeometry, spikeMaterial);
        spike.position.set( (Math.random() - 0.5) * bodySize * 0.8, bodySize * (0.5 + Math.random() * 0.4), (Math.random() - 0.5) * bodySize * 0.8 );
        spike.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI); body.add(spike);
    }
    monsterGroup.position.copy(position); monsterGroup.rotation.y = Math.random() * Math.PI * 2; return monsterGroup;
};

const createBaseFountain = (position: THREE.Vector3, teamColor: THREE.Color, teamName: string, mapRadius: number): THREE.Group => {
  const fountainGroup = new THREE.Group();
  fountainGroup.name = `${teamName}Fountain`;

  const platformRadius = mapRadius * 0.07;
  const platformHeight = 0.2;
  const platformGeometry = new THREE.CylinderGeometry(platformRadius, platformRadius, platformHeight, 24);
  const platformMaterial = new THREE.MeshStandardMaterial({ 
    color: new THREE.Color(0x777788).lerp(teamColor, 0.1),
    roughness: 0.7, 
    metalness: 0.2 
  });
  const platformMesh = new THREE.Mesh(platformGeometry, platformMaterial);
  platformMesh.castShadow = true;
  platformMesh.receiveShadow = true;
  platformMesh.position.y = platformHeight / 2;
  fountainGroup.add(platformMesh);

  const crystalSize = 1.0;
  const crystalGeometry = new THREE.OctahedronGeometry(crystalSize, 0);
  const crystalMaterial = new THREE.MeshStandardMaterial({
    color: teamColor.getHex(),
    emissive: teamColor.getHex(),
    emissiveIntensity: 0.8,
    roughness: 0.2,
    metalness: 0.1
  });
  const crystalMesh = new THREE.Mesh(crystalGeometry, crystalMaterial);
  crystalMesh.castShadow = true;
  crystalMesh.position.y = platformHeight + crystalSize * 0.6;
  fountainGroup.add(crystalMesh);

  fountainGroup.position.copy(position);
  return fountainGroup;
};


const SMOKE_TEXTURE_B64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAMAAACdt4HsAAAAQlBMVEUAAAD///////////////////////////////////////////////////////////////////////////////////8IX9KGAAAAFXRSTlMAESIzVGSWmM7u7u7u7u7u7u7u7u7kGgKxAAAAs0lEQVR42u3YWQ7AIAwEwLz/pTsNQlSpQtppP29E6AMAEEgYb0PsYwghBDXjd8pBCHGWJ+ZSMA4t3xDLMQT7GEYYIUNYLpBCNBFSSKHEtUdRBCSSKElEOYtQhBGK8D6N6YwYQwwxZJFCyCKNGAIQQAABBBBAAAEEEEAAAQQQQAABBDx9jDGMcYwJpFDCSVWKEzpSlDE6UUo3StPOjHna3gQNEWvTjDGO6G8AAQYAnQkXkXG0BwUAAAAASUVORK5CYII=';
const NUM_SMOKE_PUFFS = 15; const SMOKE_PUFF_LIFETIME = 1.2;
const SMOKE_PUFF_START_OPACITY = 0.6; const SMOKE_PUFF_START_SCALE = 0.2; const SMOKE_PUFF_END_SCALE = 1.5;
interface ActiveSmokePuff { mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>; lifetime: number; initialLifetime: number; velocity: THREE.Vector3; }

interface PlayerState {
  meshRef: React.MutableRefObject<THREE.Mesh | null>;
  position: THREE.Vector3;
  rotationY: number;
  originalColor: THREE.Color;
}

interface EnemyState {
    meshRef: React.MutableRefObject<THREE.Mesh | null>;
    position: THREE.Vector3;
    rotationY: number;
    originalColor: THREE.Color;
    currentTarget: THREE.Vector3;
    roamTimer: number;
    isMoving: boolean;
    walkAnimationTime: number;

    // New AI fields
    aiState: 'ROAMING' | 'CHASING_PLAYER' | 'ATTACKING_PLAYER' | 'FLEEING_TOWER';
    attackCooldownTimer: number;
    isAttackingVisual: boolean; 
    attackEffectTimer: number;
}

interface TowerInfo {
    position: THREE.Vector3;
    name: string;
    isBase: boolean;
    team: 'blue' | 'red';
}

interface ThreeSceneProps {
  joystickOutput: JoystickOutput;
  attackTrigger: number;
}

export const ThreeScene: React.FC<ThreeSceneProps> = ({ joystickOutput, attackTrigger }) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const joystickOutputRef = useRef(joystickOutput);
  const animationFrameIdRef = useRef<number | undefined>(undefined);
  const playerWalkAnimationTimeRef = useRef(0);
  const clockRef = useRef(new THREE.Clock());

  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  const playerStateRef = useRef<PlayerState | null>(null);
  const enemyStateRef = useRef<EnemyState | null>(null);
  const blueTowersRef = useRef<TowerInfo[]>([]);


  const cameraIsDraggingRef = useRef(false);
  const cameraLastPointerPosRef = useRef({ x: 0, y: 0 });
  const cameraPhiRef = useRef(Math.PI / 3.5); 
  const cameraThetaRef = useRef(0);
  const cameraRadiusRef = useRef(18); 
  const cameraTargetRef = useRef(new THREE.Vector3());
  const cameraWorldDirection = useRef(new THREE.Vector3());
  const activeCameraPointerIdRef = useRef<number | null>(null);

  const lastAttackTriggerRef = useRef(attackTrigger);
  const playerAttackEffectActiveRef = useRef(false);
  const playerAttackEffectTimerRef = useRef(0);

  const smokePuffsPoolRef = useRef<THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[]>([]);
  const activeSmokePuffsRef = useRef<ActiveSmokePuff[]>([]);
  const smokeTextureRef = useRef<THREE.Texture | null>(null);

  const mapRadius = 50;
  const blueTeamColor = useMemo(() => new THREE.Color(0x2563eb), []);
  const redTeamColor = useMemo(() => new THREE.Color(0xdc2626), []);
  
  const blueFountainPosition = useMemo(() => new THREE.Vector3(0, 0, -mapRadius * 0.88), [mapRadius]);
  const redFountainPosition = useMemo(() => new THREE.Vector3(0, 0, mapRadius * 0.88), [mapRadius]);


  useEffect(() => { joystickOutputRef.current = joystickOutput; }, [joystickOutput]);

  const emitSmokePuffs = useCallback((position: THREE.Vector3, countMultiplier = 1) => {
    if (!smokeTextureRef.current) return;
    let puffsEmitted = 0; const puffsToEmit = Math.floor((5 + Math.floor(Math.random() * 4)) * countMultiplier) ;
    for (const puffMesh of smokePuffsPoolRef.current) {
      if (puffsEmitted >= puffsToEmit) break;
      const isActive = activeSmokePuffsRef.current.some(p => p.mesh === puffMesh);
      if (!isActive) {
        puffMesh.visible = true; puffMesh.position.copy(position);
        puffMesh.position.x += (Math.random() - 0.5) * 0.5;
        puffMesh.position.z += (Math.random() - 0.5) * 0.5;
        puffMesh.position.y += 0.2;
        puffMesh.material.opacity = SMOKE_PUFF_START_OPACITY;
        puffMesh.scale.setScalar(SMOKE_PUFF_START_SCALE);
        const velocity = new THREE.Vector3((Math.random() - 0.5) * 0.8, 0.8 + Math.random() * 0.7, (Math.random() - 0.5) * 0.8);
        activeSmokePuffsRef.current.push({ mesh: puffMesh, lifetime: SMOKE_PUFF_LIFETIME * (0.8 + Math.random() * 0.4), initialLifetime: SMOKE_PUFF_LIFETIME, velocity });
        puffsEmitted++;
      }
    }
  }, []);

  useEffect(() => {
    if (attackTrigger > lastAttackTriggerRef.current) {
        lastAttackTriggerRef.current = attackTrigger;
        const player = playerStateRef.current;
        if (!player || !player.meshRef.current) return;
        playerAttackEffectActiveRef.current = true;
        playerAttackEffectTimerRef.current = 0;
        const material = (player.meshRef.current as THREE.Mesh).material as THREE.MeshStandardMaterial;
        material.color.lerpColors(player.originalColor, new THREE.Color(0xffffff), 0.3);
        material.emissive.copy(player.originalColor);
        material.emissiveIntensity = 0.7;
        emitSmokePuffs(player.position);
      }
  }, [attackTrigger, emitSmokePuffs]);

  useEffect(() => {
    if (!mountRef.current) return;

    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.Fog(0x87ceeb, mapRadius * 0.8, mapRadius * 2.5);

    const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, mapRadius * 3);
    cameraRef.current = camera;
    cameraTargetRef.current.set(0, CHARACTER_BASE_Y, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    rendererRef.current = renderer;
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    mountRef.current.appendChild(renderer.domElement);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.9);
    directionalLight.position.set(mapRadius * 0.7, mapRadius, mapRadius * 0.5);
    directionalLight.castShadow = true;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = mapRadius * 3;
    directionalLight.shadow.camera.left = -mapRadius * 1.5;
    directionalLight.shadow.camera.right = mapRadius * 1.5;
    directionalLight.shadow.camera.top = mapRadius * 1.5;
    directionalLight.shadow.camera.bottom = -mapRadius * 1.5;
    scene.add(directionalLight);

    const groundGeometry = new THREE.PlaneGeometry(mapRadius * 2.5, mapRadius * 2.5);
    const groundMaterial = new THREE.MeshStandardMaterial({ color: 0x90ee90, roughness: 0.9, metalness: 0.1 });
    const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);

    const laneMaterial = new THREE.MeshStandardMaterial({ color: 0xcccccc, roughness: 0.8 });
    const laneWidth = 4;
    const midLaneGeo = new THREE.PlaneGeometry(laneWidth, mapRadius * 2);
    const midLaneMesh = new THREE.Mesh(midLaneGeo, laneMaterial);
    midLaneMesh.rotation.x = -Math.PI / 2; midLaneMesh.position.y = 0.06;
    midLaneMesh.receiveShadow = true; scene.add(midLaneMesh);

    const createDiagonalLane = (p1: THREE.Vector3, p2: THREE.Vector3) => {
        const length = p1.distanceTo(p2);
        const geo = new THREE.PlaneGeometry(laneWidth, length);
        const mesh = new THREE.Mesh(geo, laneMaterial);
        mesh.position.copy(p1).lerp(p2, 0.5);
        mesh.position.y = 0.06;
        mesh.lookAt(p2.x, 0.06, p2.z);
        mesh.rotateX(-Math.PI / 2);
        mesh.receiveShadow = true;
        return mesh;
    };
    const blueTip = new THREE.Vector3(0, 0, -mapRadius * 0.8);
    const redTip = new THREE.Vector3(0, 0, mapRadius * 0.8);
    const leftPoint = new THREE.Vector3(-mapRadius * 0.8, 0, 0);
    const rightPoint = new THREE.Vector3(mapRadius * 0.8, 0, 0);

    scene.add(createDiagonalLane(blueTip, leftPoint));
    scene.add(createDiagonalLane(blueTip, rightPoint));
    scene.add(createDiagonalLane(redTip, leftPoint));
    scene.add(createDiagonalLane(redTip, rightPoint));

    const riverGeo = new THREE.PlaneGeometry(mapRadius * 2.2, laneWidth * 2);
    const riverMat = new THREE.MeshStandardMaterial({ color: 0x6082B6, roughness: 0.6, transparent: true, opacity: 0.7 });
    const riverMesh = new THREE.Mesh(riverGeo, riverMat);
    riverMesh.rotation.x = -Math.PI/2; riverMesh.position.y = 0.02;
    scene.add(riverMesh);

    scene.add(createBaseFountain(blueFountainPosition, blueTeamColor, 'Blue', mapRadius));
    scene.add(createBaseFountain(redFountainPosition, redTeamColor, 'Red', mapRadius));

    const towerDefinitions = {
        blue: [
            { pos: new THREE.Vector3(0, 0, -mapRadius * 0.85), base: true, name: 'BlueBaseTower' },
            { pos: new THREE.Vector3(0, 0, -mapRadius * 0.5), base: false, name: 'BlueMidTower' },
            { pos: new THREE.Vector3(-mapRadius * 0.45, 0, -mapRadius * 0.2), base: false, name: 'BlueLeftTower' },
            { pos: new THREE.Vector3(mapRadius * 0.45, 0, -mapRadius * 0.2), base: false, name: 'BlueRightTower' },
        ],
        red: [
            { pos: new THREE.Vector3(0, 0, mapRadius * 0.85), base: true, name: 'RedBaseTower' },
            { pos: new THREE.Vector3(0, 0, mapRadius * 0.5), base: false, name: 'RedMidTower' },
            { pos: new THREE.Vector3(-mapRadius * 0.45, 0, mapRadius * 0.2), base: false, name: 'RedLeftTower' },
            { pos: new THREE.Vector3(mapRadius * 0.45, 0, mapRadius * 0.2), base: false, name: 'RedRightTower' },
        ]
    };
    blueTowersRef.current = []; // Clear before populating
    towerDefinitions.blue.forEach(tp => {
        scene.add(createTower(tp.pos, blueTeamColor.getHex(), tp.name, tp.base));
        blueTowersRef.current.push({ position: tp.pos, name: tp.name, isBase: tp.base, team: 'blue' });
    });
    towerDefinitions.red.forEach(tp => scene.add(createTower(tp.pos, redTeamColor.getHex(), tp.name, tp.base)));


    let treePositions: THREE.Vector3[] = [];
    const jungleAreas = [
        { xMin: -mapRadius*0.7, xMax: -laneWidth*1.5, zMin: -mapRadius*0.4, zMax: mapRadius*0.4 },
        { xMin: laneWidth*1.5, xMax: mapRadius*0.7, zMin: -mapRadius*0.4, zMax: mapRadius*0.4 },
    ];
    for (const area of jungleAreas) {
        for (let i = 0; i < 20; i++) {
            const x = Math.random() * (area.xMax - area.xMin) + area.xMin;
            const z = Math.random() * (area.zMax - area.zMin) + area.zMin;
            if (Math.abs(x) + Math.abs(z) < mapRadius * 0.95 && Math.abs(z) > laneWidth * 1.5) {
                 treePositions.push(new THREE.Vector3(x, 0, z));
            }
        }
    }
    treePositions = shuffleArray(treePositions);
    treePositions.slice(0, 30).forEach(pos => scene.add(createTree(pos)));

    const monsterPositions: THREE.Vector3[] = [];
    for (const area of jungleAreas) {
        for (let i = 0; i < 3; i++) {
            const x = Math.random() * (area.xMax - area.xMin) + area.xMin;
            const z = Math.random() * (area.zMax - area.zMin) + area.zMin;
            if (Math.abs(x) + Math.abs(z) < mapRadius * 0.9 && Math.abs(z) > laneWidth * 2) {
                monsterPositions.push(new THREE.Vector3(x, 0, z));
            }
        }
    }
    monsterPositions.forEach(pos => scene.add(createJungleMonsterPlaceholder(pos)));

    // Player Setup
    const playerMesh = createCharacterMesh(blueTeamColor, 'player');
    scene.add(playerMesh);
    playerStateRef.current = {
        meshRef: { current: playerMesh },
        position: blueFountainPosition.clone(),
        rotationY: 0,
        originalColor: blueTeamColor.clone(),
    };
    playerMesh.position.copy(playerStateRef.current.position);
    playerMesh.position.y = CHARACTER_BASE_Y;

    // Enemy Setup
    const enemyMesh = createCharacterMesh(redTeamColor, 'enemy');
    scene.add(enemyMesh);
    const initialEnemyTarget = getRandomRoamTarget(mapRadius, redFountainPosition, blueFountainPosition, redFountainPosition);
    enemyStateRef.current = {
        meshRef: { current: enemyMesh },
        position: redFountainPosition.clone(),
        rotationY: Math.PI, 
        originalColor: redTeamColor.clone(),
        currentTarget: initialEnemyTarget,
        roamTimer: ENEMY_ROAM_TARGET_UPDATE_MIN_INTERVAL + Math.random() * (ENEMY_ROAM_TARGET_UPDATE_MAX_INTERVAL - ENEMY_ROAM_TARGET_UPDATE_MIN_INTERVAL),
        isMoving: false,
        walkAnimationTime: 0,
        // New AI fields
        aiState: 'ROAMING',
        attackCooldownTimer: 0,
        isAttackingVisual: false,
        attackEffectTimer: 0,
    };
    enemyMesh.position.copy(enemyStateRef.current.position);
    enemyMesh.position.y = CHARACTER_BASE_Y;
    enemyMesh.rotation.y = enemyStateRef.current.rotationY;


    const smokeLoader = new THREE.TextureLoader();
    const texture = smokeLoader.load(
        SMOKE_TEXTURE_B64,
        undefined, // onLoad - TextureLoader handles internal needsUpdate for image load
        undefined, // onProgress
        (error) => { // onError
            console.error('An error occurred loading the smoke texture:', error);
        }
    );
    // Configure the texture: Disable mipmaps and set linear filtering
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    smokeTextureRef.current = texture; // Store the configured texture

    for (let i = 0; i < NUM_SMOKE_PUFFS; i++) {
      const puffGeo = new THREE.PlaneGeometry(1, 1);
      const puffMat = new THREE.MeshBasicMaterial({ map: smokeTextureRef.current, transparent: true, opacity: 0, depthWrite: false });
      const puffMesh = new THREE.Mesh(puffGeo, puffMat);
      puffMesh.visible = false;
      smokePuffsPoolRef.current.push(puffMesh);
      scene.add(puffMesh);
    }

    const canvas = renderer.domElement;

    const onWindowPointerMoveCallback = (event: PointerEvent) => {
        if (!cameraIsDraggingRef.current || event.pointerId !== activeCameraPointerIdRef.current) {
            return;
        }
        const deltaX = event.clientX - cameraLastPointerPosRef.current.x;
        const deltaY = event.clientY - cameraLastPointerPosRef.current.y;

        let newPhi = cameraPhiRef.current - deltaY * 0.005;
        const MIN_PHI_ABS = 0.1; 
        const MAX_PHI_ABS = Math.PI - 0.1; 

        const targetYForCamera = cameraTargetRef.current.y; 
        const radius = cameraRadiusRef.current;
        
        let maxPhiForGround = MAX_PHI_ABS;
        if (radius > 0.001) { 
            const cosVal = (MIN_CAMERA_Y_POSITION - targetYForCamera) / radius;
            if (cosVal >= -1 && cosVal <= 1) { 
                maxPhiForGround = Math.min(MAX_PHI_ABS, Math.acos(cosVal));
            } else if (cosVal > 1) { 
                maxPhiForGround = Math.min(MAX_PHI_ABS, Math.PI / 2); 
            }
        }
        
        cameraThetaRef.current -= deltaX * 0.005;
        cameraPhiRef.current = THREE.MathUtils.clamp(newPhi, MIN_PHI_ABS, maxPhiForGround);
        
        cameraLastPointerPosRef.current = { x: event.clientX, y: event.clientY };
    };

    const onWindowPointerUpOrCancelCallback = (event: PointerEvent) => {
        if (event.pointerId === activeCameraPointerIdRef.current) {
            cameraIsDraggingRef.current = false;
            if (canvas.isConnected) { 
                try {
                    canvas.releasePointerCapture(event.pointerId);
                } catch (e) { console.warn("Failed to release pointer capture:", e); }
            }
            activeCameraPointerIdRef.current = null;

            window.removeEventListener('pointermove', onWindowPointerMoveCallback);
            window.removeEventListener('pointerup', onWindowPointerUpOrCancelCallback);
            window.removeEventListener('pointercancel', onWindowPointerUpOrCancelCallback);
        }
    };

    const handleCanvasPointerDown = (event: PointerEvent) => {
        if (event.pointerType === 'mouse' && event.button !== 0) { 
            if (event.button === 2) event.preventDefault(); 
            return;
        }
        if (cameraIsDraggingRef.current && event.pointerId !== activeCameraPointerIdRef.current) {
            return;
        }
        
        activeCameraPointerIdRef.current = event.pointerId;
        cameraIsDraggingRef.current = true;
        cameraLastPointerPosRef.current = { x: event.clientX, y: event.clientY };
        
        try {
            canvas.setPointerCapture(event.pointerId);
        } catch (e) {
            console.warn("Failed to set pointer capture:", e);
            cameraIsDraggingRef.current = false; 
            activeCameraPointerIdRef.current = null;
            return; 
        }
        event.preventDefault(); 

        window.addEventListener('pointermove', onWindowPointerMoveCallback);
        window.addEventListener('pointerup', onWindowPointerUpOrCancelCallback);
        window.addEventListener('pointercancel', onWindowPointerUpOrCancelCallback);
    };

    canvas.addEventListener('pointerdown', handleCanvasPointerDown);

    const handleResize = () => {
        if (cameraRef.current && rendererRef.current) {
            cameraRef.current.aspect = window.innerWidth / window.innerHeight;
            cameraRef.current.updateProjectionMatrix();
            rendererRef.current.setSize(window.innerWidth, window.innerHeight);
        }
    };
    window.addEventListener('resize', handleResize);

    clockRef.current.start();
    animate();

    return () => {
        if (animationFrameIdRef.current) cancelAnimationFrame(animationFrameIdRef.current);
        if (rendererRef.current && mountRef.current && mountRef.current.contains(rendererRef.current.domElement)) {
             mountRef.current.removeChild(rendererRef.current.domElement);
        }
        rendererRef.current?.dispose();
        sceneRef.current?.traverse(object => {
            if (object instanceof THREE.Mesh) {
                object.geometry?.dispose();
                const materials = Array.isArray(object.material) ? object.material : [object.material];
                materials.forEach(material => material?.dispose());
            }
        });
        
        smokeTextureRef.current?.dispose();
        window.removeEventListener('resize', handleResize);
        canvas.removeEventListener('pointerdown', handleCanvasPointerDown); 
        
        if (activeCameraPointerIdRef.current !== null) {
            window.removeEventListener('pointermove', onWindowPointerMoveCallback);
            window.removeEventListener('pointerup', onWindowPointerUpOrCancelCallback);
            window.removeEventListener('pointercancel', onWindowPointerUpOrCancelCallback);
            if (canvas.isConnected) { 
                try {
                    canvas.releasePointerCapture(activeCameraPointerIdRef.current);
                } catch (e) { /* Silently fail on unmount */ }
            }
            activeCameraPointerIdRef.current = null;
            cameraIsDraggingRef.current = false;
        }
        
        sceneRef.current = null;
        cameraRef.current = null;
        rendererRef.current = null;
        playerStateRef.current = null;
        enemyStateRef.current = null;
        smokePuffsPoolRef.current = [];
        activeSmokePuffsRef.current = [];
        blueTowersRef.current = [];
    };
  }, [blueTeamColor, redTeamColor, emitSmokePuffs, blueFountainPosition, redFountainPosition]);


  const animate = () => {
    animationFrameIdRef.current = requestAnimationFrame(animate);
    const delta = clockRef.current.getDelta();
    const joyInput = joystickOutputRef.current;
    const player = playerStateRef.current;
    const enemy = enemyStateRef.current;

    // Player Logic
    if (player && player.meshRef.current && cameraRef.current) {
        cameraRef.current.getWorldDirection(cameraWorldDirection.current);
        cameraWorldDirection.current.y = 0;
        cameraWorldDirection.current.normalize();
        const moveSpeed = 4.0;
        const rotationSpeed = Math.PI * 2;
        let moveVector = new THREE.Vector3();
        let targetRotation = player.rotationY;

        if (joyInput.active) {
            playerWalkAnimationTimeRef.current += delta * 8;
            const forwardAmount = -joyInput.y;
            const strafeAmount = -joyInput.x; // Corrected strafing logic
            const moveForward = cameraWorldDirection.current.clone().multiplyScalar(forwardAmount);
            const cameraRight = new THREE.Vector3().crossVectors(cameraRef.current.up, cameraWorldDirection.current).normalize();
            const moveStrafe = cameraRight.multiplyScalar(strafeAmount);
            moveVector.add(moveForward).add(moveStrafe);
            if (moveVector.lengthSq() > 0.01) {
                moveVector.normalize();
                targetRotation = Math.atan2(moveVector.x, moveVector.z);
            }
        } else {
            playerWalkAnimationTimeRef.current = 0;
        }

        player.rotationY += shortestAngleDiff(player.rotationY, targetRotation) * rotationSpeed * delta;
        player.meshRef.current.rotation.y = player.rotationY;
        const actualMoveSpeed = moveSpeed * delta;
        const prevPlayerPos = player.position.clone();
        player.position.add(moveVector.clone().multiplyScalar(actualMoveSpeed));
        
        if (Math.abs(player.position.x) + Math.abs(player.position.z) > mapRadius * 0.98) {
            player.position.copy(prevPlayerPos); 
        }
        player.meshRef.current.position.x = player.position.x;
        player.meshRef.current.position.y = CHARACTER_BASE_Y + (joyInput.active ? Math.sin(playerWalkAnimationTimeRef.current) * 0.08 : 0);
        player.meshRef.current.position.z = player.position.z;

        if (playerAttackEffectActiveRef.current) {
            playerAttackEffectTimerRef.current += delta;
            if (playerAttackEffectTimerRef.current >= PLAYER_ATTACK_EFFECT_DURATION) {
                playerAttackEffectActiveRef.current = false;
                playerAttackEffectTimerRef.current = 0;
                const material = (player.meshRef.current as THREE.Mesh).material as THREE.MeshStandardMaterial;
                material.color.copy(player.originalColor);
                material.emissive.setHex(0x000000);
                material.emissiveIntensity = 0;
            }
        }
        cameraTargetRef.current.set(player.position.x, CHARACTER_BASE_Y + 0.5, player.position.z);
    }

    // Enemy Logic
    if (enemy && enemy.meshRef.current && player && player.meshRef.current) {
        enemy.attackCooldownTimer = Math.max(0, enemy.attackCooldownTimer - delta);
        enemy.roamTimer = Math.max(0, enemy.roamTimer - delta);

        if (enemy.isAttackingVisual) {
            enemy.attackEffectTimer += delta;
            const enemyMaterial = enemy.meshRef.current.material as THREE.MeshStandardMaterial;
            if (enemy.attackEffectTimer >= ENEMY_ATTACK_EFFECT_DURATION) {
                enemy.isAttackingVisual = false;
                enemy.attackEffectTimer = 0;
                enemyMaterial.color.copy(enemy.originalColor);
                enemyMaterial.emissive.setHex(0x000000);
                enemyMaterial.emissiveIntensity = 0;
            } else {
                // Keep visual active
                const lerpFactor = Math.sin(enemy.attackEffectTimer / ENEMY_ATTACK_EFFECT_DURATION * Math.PI) * 0.7; // Pulsate
                enemyMaterial.color.lerpColors(enemy.originalColor, new THREE.Color(0xffcc66), lerpFactor);
                enemyMaterial.emissive.setHex(0xffaa33);
                enemyMaterial.emissiveIntensity = lerpFactor * 1.5;
            }
        }

        const playerPos = player.position;
        const enemyPos = enemy.position;
        const distanceToPlayerSq = enemyPos.distanceToSquared(playerPos);
        let newAiState = enemy.aiState;
        let newTarget = enemy.currentTarget;
        let forceNewRoamTarget = false;

        // 1. Check for Tower Threat (Highest Priority)
        let closestHostileTowerDistSq = Infinity;
        let threateningTowerPos: THREE.Vector3 | null = null;

        for (const tower of blueTowersRef.current) {
            const distSq = enemyPos.distanceToSquared(tower.position);
            if (distSq < closestHostileTowerDistSq) {
                closestHostileTowerDistSq = distSq;
                threateningTowerPos = tower.position;
            }
        }

        if (threateningTowerPos && closestHostileTowerDistSq < TOWER_AVOIDANCE_RANGE_ENEMY_SQR) {
            newAiState = 'FLEEING_TOWER';
            const directionAwayFromTower = enemyPos.clone().sub(threateningTowerPos).normalize();
            newTarget = enemyPos.clone().addScaledVector(directionAwayFromTower, FLEE_DISTANCE_FROM_TOWER);
        } else {
             // Not fleeing a tower, evaluate other states
            if (enemy.aiState === 'FLEEING_TOWER') { // Was fleeing, now clear
                newAiState = 'ROAMING'; // Default back to roaming
                forceNewRoamTarget = true; // Find a new spot
            }

            // 2. Attack Player (If in range, cooldown ready, and not currently attacking visual)
            if (newAiState !== 'FLEEING_TOWER' && distanceToPlayerSq < ENEMY_ATTACK_RANGE_SQR && enemy.attackCooldownTimer <= 0 && !enemy.isAttackingVisual) {
                newAiState = 'ATTACKING_PLAYER';
                enemy.isAttackingVisual = true;
                enemy.attackEffectTimer = 0; // Start effect timer
                enemy.attackCooldownTimer = ENEMY_ATTACK_COOLDOWN;
                emitSmokePuffs(enemyPos, 0.8);
                // Target remains player's current position during attack animation
                newTarget = playerPos.clone(); 
            } 
            // 3. Chase Player (If detected and not attacking or fleeing)
            else if (newAiState !== 'FLEEING_TOWER' && newAiState !== 'ATTACKING_PLAYER' && distanceToPlayerSq < ENEMY_DETECTION_RANGE_SQR) {
                newAiState = 'CHASING_PLAYER';
                newTarget = playerPos.clone();
            } 
            // 4. Roam (If not doing anything else or finished an action)
            else if (newAiState !== 'FLEEING_TOWER' && newAiState !== 'ATTACKING_PLAYER') {
                 if (newAiState === 'CHASING_PLAYER' && distanceToPlayerSq >= ENEMY_DETECTION_RANGE_SQR) { // Lost player
                    newAiState = 'ROAMING';
                    forceNewRoamTarget = true;
                 } else if (newAiState === 'ROAMING' && (enemy.roamTimer <= 0 || enemyPos.distanceToSquared(enemy.currentTarget) < ENEMY_TARGET_REACH_THRESHOLD ** 2)) {
                    forceNewRoamTarget = true;
                 }
            }
        }
        
        if (newAiState === 'ATTACKING_PLAYER' && enemy.isAttackingVisual && enemy.attackEffectTimer < ENEMY_ATTACK_EFFECT_DURATION) {
           // Enemy is in attack animation, don't switch state or target yet, let visual play out
           // It might briefly stop or lunge, for now it just holds position implicitly by not updating target to chase.
           enemy.isMoving = false;
        } else if (newAiState === 'ATTACKING_PLAYER' && !enemy.isAttackingVisual) { // Attack visual finished
            // Re-evaluate: if player still in detection, chase, else roam
            if (distanceToPlayerSq < ENEMY_DETECTION_RANGE_SQR) {
                newAiState = 'CHASING_PLAYER';
                newTarget = playerPos.clone();
            } else {
                newAiState = 'ROAMING';
                forceNewRoamTarget = true;
            }
        }


        enemy.aiState = newAiState;
        if (forceNewRoamTarget) {
             enemy.currentTarget = getRandomRoamTarget(mapRadius, enemyPos, blueFountainPosition, redFountainPosition);
             enemy.roamTimer = ENEMY_ROAM_TARGET_UPDATE_MIN_INTERVAL + Math.random() * (ENEMY_ROAM_TARGET_UPDATE_MAX_INTERVAL - ENEMY_ROAM_TARGET_UPDATE_MIN_INTERVAL);
        } else {
            enemy.currentTarget = newTarget;
        }
        
        // Movement and Animation based on determined state and target
        if (enemy.aiState !== 'ATTACKING_PLAYER' || !enemy.isAttackingVisual) { // Don't move if in attack animation
            const directionToTarget = new THREE.Vector3().subVectors(enemy.currentTarget, enemyPos);
            if (directionToTarget.lengthSq() > 0.01) {
                directionToTarget.normalize();
                const targetRotation = Math.atan2(directionToTarget.x, directionToTarget.z);
                enemy.rotationY += shortestAngleDiff(enemy.rotationY, targetRotation) * ENEMY_ROTATION_SPEED * delta;
                enemy.meshRef.current.rotation.y = enemy.rotationY;

                const actualMoveSpeed = ENEMY_MOVE_SPEED * delta;
                const prevEnemyPos = enemy.position.clone();
                enemy.position.addScaledVector(directionToTarget, actualMoveSpeed);
                
                if (Math.abs(enemy.position.x) + Math.abs(enemy.position.z) > mapRadius * 0.98) {
                    enemy.position.copy(prevEnemyPos);
                    if(enemy.aiState !== 'FLEEING_TOWER') { // Don't immediately re-target if fleeing OOB
                         enemy.roamTimer = 0; // Force quick retarget if stuck roaming
                    }
                }
                enemy.isMoving = true;
                enemy.walkAnimationTime += delta * 7;
                enemy.meshRef.current.position.y = CHARACTER_BASE_Y + Math.sin(enemy.walkAnimationTime) * 0.07;
            } else {
                enemy.isMoving = false;
                enemy.walkAnimationTime = 0;
                enemy.meshRef.current.position.y = CHARACTER_BASE_Y;
                 if (enemy.aiState === 'ROAMING' || enemy.aiState === 'FLEEING_TOWER') { // Reached roam/flee target
                    enemy.roamTimer = 0; // Get new target
                 }
            }
        } else { // Is attacking visually
            enemy.isMoving = false; // Stand still during attack visual
            enemy.walkAnimationTime = 0;
            enemy.meshRef.current.position.y = CHARACTER_BASE_Y;
        }
        enemy.meshRef.current.position.x = enemy.position.x;
        enemy.meshRef.current.position.z = enemy.position.z;
    }


    // Smoke Puffs Update
    activeSmokePuffsRef.current = activeSmokePuffsRef.current.filter(puff => {
        puff.lifetime -= delta;
        if (puff.lifetime <= 0) {
            puff.mesh.visible = false;
            return false;
        }
        puff.mesh.position.addScaledVector(puff.velocity, delta);
        const t = 1 - (puff.lifetime / puff.initialLifetime);
        puff.mesh.material.opacity = SMOKE_PUFF_START_OPACITY * (1 - t);
        puff.mesh.scale.setScalar(THREE.MathUtils.lerp(SMOKE_PUFF_START_SCALE, SMOKE_PUFF_END_SCALE, t));
        if (cameraRef.current) puff.mesh.quaternion.copy(cameraRef.current.quaternion);
        return true;
    });

    // Camera Update
    if (cameraRef.current) {
        const camX = cameraTargetRef.current.x + cameraRadiusRef.current * Math.sin(cameraPhiRef.current) * Math.sin(cameraThetaRef.current);
        const camY = cameraTargetRef.current.y + cameraRadiusRef.current * Math.cos(cameraPhiRef.current);
        const camZ = cameraTargetRef.current.z + cameraRadiusRef.current * Math.sin(cameraPhiRef.current) * Math.cos(cameraThetaRef.current);
        cameraRef.current.position.set(camX, camY, camZ);
        cameraRef.current.lookAt(cameraTargetRef.current);
    }

    // Render
    if (rendererRef.current && sceneRef.current && cameraRef.current) {
        rendererRef.current.render(sceneRef.current, cameraRef.current);
    }
  };

  return <div ref={mountRef} className="w-full h-full" style={{ touchAction: 'none' }} aria-label="3D Scene Area for camera interaction" />;
};
