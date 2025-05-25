
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Joystick } from './components/Joystick';
import { ThreeScene } from './components/ThreeScene';
import type { JoystickOutput } from './types';

import { Analytics } from '@vercel/analytics/react';

const initialJoystickData: JoystickOutput = { x: 0, y: 0, active: false };

const App: React.FC = () => {
  const [joystickData, setJoystickData] = useState<JoystickOutput>(initialJoystickData); // From touch joystick
  const [keyboardMovement, setKeyboardMovement] = useState<JoystickOutput>(initialJoystickData); // From keyboard
  const [attackTrigger, setAttackTrigger] = useState(0);
  const [isAttackButtonPressed, setIsAttackButtonPressed] = useState(false);
  const appContainerRef = useRef<HTMLDivElement>(null);

  const handleAttack = useCallback(() => {
    setAttackTrigger(prev => prev + 1);
    console.log("Attack triggered");
  }, []);

  // Combine keyboard and joystick inputs
  const effectiveJoystickData = useMemo<JoystickOutput>(() => {
    if (keyboardMovement.active) {
      return keyboardMovement;
    }
    if (joystickData.active) {
      return joystickData;
    }
    return initialJoystickData; // Neither is active
  }, [keyboardMovement, joystickData]);

  // Effect to focus the main container on mount
  useEffect(() => {
    if (appContainerRef.current) {
      appContainerRef.current.focus();
    }
  }, []);


  // Keyboard event listeners for MOVEMENT (WASD)
  useEffect(() => {
    const pressedKeys = new Set<string>();

    const updateKeyboardMovementState = () => {
      let x = 0;
      let y = 0;
      let active = false;

      if (pressedKeys.has('w')) { y = -1; active = true; }
      if (pressedKeys.has('s')) { y =  1; active = true; }
      if (pressedKeys.has('a')) { x = -1; active = true; }
      if (pressedKeys.has('d')) { x =  1; active = true; }
      
      // Normalize diagonal movement
      if (x !== 0 && y !== 0) {
          const length = Math.sqrt(x*x + y*y);
          x /= length;
          y /= length;
      }
      setKeyboardMovement({ x, y, active });
    };

    const handleMovementKeyDown = (event: KeyboardEvent) => { // Renamed to avoid confusion
      const key = event.key.toLowerCase();
      if (['w', 'a', 's', 'd'].includes(key)) {
        event.preventDefault(); // Prevent page scroll, etc.
        if (!pressedKeys.has(key)) {
          pressedKeys.add(key);
          updateKeyboardMovementState();
        }
      }
    };

    const handleMovementKeyUp = (event: KeyboardEvent) => { // Renamed to avoid confusion
      const key = event.key.toLowerCase();
      if (['w', 'a', 's', 'd'].includes(key)) {
        event.preventDefault();
        if (pressedKeys.has(key)) {
          pressedKeys.delete(key);
          updateKeyboardMovementState();
        }
      }
    };

    window.addEventListener('keydown', handleMovementKeyDown);
    window.addEventListener('keyup', handleMovementKeyUp);

    return () => {
      window.removeEventListener('keydown', handleMovementKeyDown);
      window.removeEventListener('keyup', handleMovementKeyUp);
      setKeyboardMovement(initialJoystickData); 
    };
  }, []); // No attack-related dependencies

  // Keep a ref to the isAttackButtonPressed state for use in stable event listeners
  const isAttackButtonPressedRef = useRef(isAttackButtonPressed);
  useEffect(() => {
    isAttackButtonPressedRef.current = isAttackButtonPressed;
  }, [isAttackButtonPressed]);

  // Keyboard event listeners for ATTACK (Spacebar)
  useEffect(() => {
    const handleAttackKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === ' ') { // Spacebar
        event.preventDefault();
        if (!isAttackButtonPressedRef.current) { 
            handleAttack();
            setIsAttackButtonPressed(true);
        }
      }
    };

    const handleAttackKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (key === ' ') { // Spacebar
        event.preventDefault();
        setIsAttackButtonPressed(false);
      }
    };

    window.addEventListener('keydown', handleAttackKeyDown);
    window.addEventListener('keyup', handleAttackKeyUp);

    return () => {
      window.removeEventListener('keydown', handleAttackKeyDown);
      window.removeEventListener('keyup', handleAttackKeyUp);
    };
  }, [handleAttack]); // Dependencies are stable: `handleAttack` (useCallback [])


  return (
    <div 
      ref={appContainerRef}
      tabIndex={-1}
      className="relative w-screen h-screen overflow-hidden bg-gray-900 text-white outline-none"
    >
      <ThreeScene
        joystickOutput={effectiveJoystickData} // Pass combined input
        attackTrigger={attackTrigger}
      />
      <Joystick onMove={setJoystickData} /> {/* Joystick updates joystickData */}

      <div className="fixed bottom-10 right-10 md:bottom-16 md:right-16 flex space-x-4">
        <button
          onMouseDown={() => {
            handleAttack();
            setIsAttackButtonPressed(true);
          }}
          onMouseUp={() => setIsAttackButtonPressed(false)}
          onMouseLeave={() => setIsAttackButtonPressed(false)}
          onTouchStart={(e) => {
            e.preventDefault(); 
            handleAttack();
            setIsAttackButtonPressed(true);
          }}
          onTouchEnd={() => setIsAttackButtonPressed(false)}
          onTouchCancel={() => setIsAttackButtonPressed(false)}
          className={`w-20 h-20 rounded-full text-white font-semibold text-sm shadow-2xl z-50 flex items-center justify-center backdrop-blur-sm focus:outline-none transition-colors duration-150
                      bg-red-500 hover:bg-red-600 active:bg-red-700 focus:ring-red-400
                      ${isAttackButtonPressed ? 'ring-2 ring-offset-2 ring-offset-red-700 ring-white transform scale-95' : 'transform scale-100'}`}
          aria-label="Attack"
          style={{ touchAction: 'manipulation' }} 
        >
          Attack
        </button>
      </div>
      <Analytics />
    </div>
  );
};

export default App;
