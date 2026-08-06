import { Canvas } from "@react-three/fiber";
import { GREEN_COLOR, RED_COLOR, WHITE_COLOR, YELLOW_COLOR } from "../constants";
import {
  THREE_BAD_FRAME_STEP,
  THREE_CAMERA_FOV_DEGREES,
  THREE_CAMERA_Z,
  THREE_DONUT_RADIAL_SEGMENTS,
  THREE_DONUT_RADIUS,
  THREE_DONUT_TUBE_RADIUS,
  THREE_DONUT_TUBULAR_SEGMENTS,
} from "../three-constants";

export interface ThreeDonutStageProps {
  frame: number;
  optimizationProgress: number;
  problemProgress: number;
}

const HeroDonut = ({ frame, optimizationProgress, problemProgress }: ThreeDonutStageProps) => {
  const steppedFrame = Math.floor(frame / THREE_BAD_FRAME_STEP) * THREE_BAD_FRAME_STEP;
  const rotationFrame = steppedFrame + (frame - steppedFrame) * optimizationProgress;
  const materialColor = optimizationProgress > 0.5 ? GREEN_COLOR : WHITE_COLOR;
  const warningRingOpacity = problemProgress * (1 - optimizationProgress);

  return (
    <group rotation={[0.38, rotationFrame * 0.012, -0.18 + Math.sin(rotationFrame * 0.018) * 0.08]}>
      <mesh>
        <torusGeometry
          args={[
            THREE_DONUT_RADIUS,
            THREE_DONUT_TUBE_RADIUS,
            THREE_DONUT_RADIAL_SEGMENTS,
            THREE_DONUT_TUBULAR_SEGMENTS,
          ]}
        />
        <meshStandardMaterial
          color={materialColor}
          emissive={optimizationProgress > 0.5 ? GREEN_COLOR : YELLOW_COLOR}
          emissiveIntensity={0.06 + optimizationProgress * 0.12}
          metalness={0.58}
          roughness={0.27}
        />
      </mesh>
      <mesh scale={1.025 + warningRingOpacity * 0.025}>
        <torusGeometry
          args={[
            THREE_DONUT_RADIUS,
            THREE_DONUT_TUBE_RADIUS,
            THREE_DONUT_RADIAL_SEGMENTS,
            THREE_DONUT_TUBULAR_SEGMENTS,
          ]}
        />
        <meshBasicMaterial
          color={RED_COLOR}
          opacity={warningRingOpacity * 0.28}
          transparent
          wireframe
        />
      </mesh>
    </group>
  );
};

export const ThreeDonutStage = ({
  frame,
  optimizationProgress,
  problemProgress,
}: ThreeDonutStageProps) => (
  <div className="three-donut-stage" aria-hidden="true">
    <Canvas
      camera={{ fov: THREE_CAMERA_FOV_DEGREES, position: [0, 0, THREE_CAMERA_Z] }}
      dpr={[1, 1.5]}
      gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
    >
      <ambientLight intensity={0.72} />
      <directionalLight color={WHITE_COLOR} intensity={3.2} position={[4, 5, 6]} />
      <pointLight
        color={optimizationProgress > 0.5 ? GREEN_COLOR : YELLOW_COLOR}
        intensity={18}
        position={[-4, -2, 4]}
      />
      <HeroDonut
        frame={frame}
        optimizationProgress={optimizationProgress}
        problemProgress={problemProgress}
      />
    </Canvas>
  </div>
);
