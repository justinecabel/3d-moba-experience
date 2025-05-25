

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import type { JoystickOutput } from '../types';

interface JoystickProps {
  onMove: (output: JoystickOutput) => void;
  size?: number; // Diameter of the joystick base
  stickSize?: number; // Diameter of rejuvenique oil stick
  baseColor?: string;
  stickColor?: string;
}

export const Joystick: React.FC<JoystickProps> = ({
  onMove,
  size = 120,
  stickSize = 60,
  baseColor = 'rgba(0, 0, 0, 0.3)',
  stickColor = 'rgba(255, 255, 255, 0.4)',
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [knobPosition, setKnobPosition] = useState({ x: 0, y: 0 });
  const baseRef = useRef<HTMLDivElement>(null);
  const activeTouchIdRef = useRef<number | null>(null);

  const maxOffset = useMemo(() => (size - stickSize) / 2, [size, stickSize]);

  const updateKnobPosition = useCallback((event: MouseEvent | TouchEvent, isInitialTouch: boolean = false) => {
    if (!baseRef.current) return;

    const baseRect = baseRef.current.getBoundingClientRect();
    let clientX: number, clientY: number;

    if ('touches' in event) { // TouchEvent
      let touchToProcess: Touch | null = null;

      if (isInitialTouch) {
          // For the initial touch, activeTouchIdRef.current has just been set by the caller (handleInteractionStart).
          // We find this touch in changedTouches.
          for (let i = 0; i < event.changedTouches.length; i++) {
              if (event.changedTouches[i].identifier === activeTouchIdRef.current) {
                  touchToProcess = event.changedTouches[i];
                  break;
              }
          }
      } else { // Called from handleInteractionMove
          if (activeTouchIdRef.current === null) return; // Not dragging via touch, or error
          for (let i = 0; i < event.touches.length; i++) {
              if (event.touches[i].identifier === activeTouchIdRef.current) {
                  touchToProcess = event.touches[i];
                  break;
              }
          }
      }

      if (!touchToProcess) {
        // This might happen if the touch that started the drag has ended,
        // but a 'touchmove' event was already queued, or if the active touch ID isn't found.
        return;
      }
      clientX = touchToProcess.clientX;
      clientY = touchToProcess.clientY;
    } else { // MouseEvent
      clientX = event.clientX;
      clientY = event.clientY;
    }

    let x = clientX - (baseRect.left + size / 2);
    let y = clientY - (baseRect.top + size / 2);

    const distance = Math.sqrt(x * x + y * y);

    if (distance > maxOffset) {
      x = (x / distance) * maxOffset;
      y = (y / distance) * maxOffset;
    }

    setKnobPosition({ x, y });
    onMove({
      x: x / maxOffset,
      y: y / maxOffset,
      active: true,
    });
  }, [maxOffset, onMove, size]); // Dependencies for calculations and callback

  const handleInteractionStart = useCallback((event: React.MouseEvent | React.TouchEvent) => {
    setIsDragging(true);
    if (event.cancelable) {
      event.preventDefault();
    }
    const nativeEvent = event.nativeEvent as MouseEvent | TouchEvent;
    let isInitial = false;

    if (nativeEvent.type.startsWith('touch')) {
      activeTouchIdRef.current = (nativeEvent as TouchEvent).changedTouches[0].identifier;
      isInitial = true;
    } else {
      activeTouchIdRef.current = null; // Mouse doesn't use touch ID
    }
    updateKnobPosition(nativeEvent, isInitial);
  }, [updateKnobPosition, setIsDragging]);


  const handleInteractionMove = useCallback((event: MouseEvent | TouchEvent) => {
    if (!isDragging) return;
    // For touchmove on document, prevent default to avoid page scroll if touch started on joystick
    if (event.type === 'touchmove' && event.cancelable) {
        // Check if the active touch is part of this event's touches.
        // This is an extra precaution, primary check is in updateKnobPosition.
        let isJoystickTouchMoving = false;
        if ('touches' in event && activeTouchIdRef.current !== null) {
            for(let i=0; i < event.touches.length; i++) {
                if (event.touches[i].identifier === activeTouchIdRef.current) {
                    isJoystickTouchMoving = true;
                    break;
                }
            }
        } else if (!('touches' in event)) { // Mouse event
            isJoystickTouchMoving = true;
        }

        if (isJoystickTouchMoving) {
            event.preventDefault();
        } else {
            // If the active joystick touch isn't part of this move event,
            // then this move event is for a different touch. Don't preventDefault here.
            // This scenario implies updateKnobPosition would also not find the active touch.
        }
    }
    updateKnobPosition(event, false); // Not an initial touch
  }, [isDragging, updateKnobPosition]);

  // Specific handler for global touchend/touchcancel
  const globalTouchEndHandler = useCallback((event: TouchEvent) => {
    if (!isDragging || activeTouchIdRef.current === null) return;

    let joystickTouchEnded = false;
    for (let i = 0; i < event.changedTouches.length; i++) {
      if (event.changedTouches[i].identifier === activeTouchIdRef.current) {
        joystickTouchEnded = true;
        break;
      }
    }

    if (joystickTouchEnded) {
      setIsDragging(false);
      setKnobPosition({ x: 0, y: 0 });
      onMove({ x: 0, y: 0, active: false });
      activeTouchIdRef.current = null;
    }
  }, [isDragging, onMove, setIsDragging]); // Added setIsDragging dependency

  // Specific handler for global mouseup
  const globalMouseUpHandler = useCallback(() => {
    if (!isDragging) return;
    // For mouse, any mouseup while dragging joystick ends it
    setIsDragging(false);
    setKnobPosition({ x: 0, y: 0 });
    onMove({ x: 0, y: 0, active: false });
    activeTouchIdRef.current = null; // Also clear for mouse, though not strictly used for identification
  }, [isDragging, onMove, setIsDragging]); // Added setIsDragging dependency

  useEffect(() => {
    if (isDragging) {
      document.addEventListener('mousemove', handleInteractionMove);
      document.addEventListener('touchmove', handleInteractionMove, { passive: false }); // passive:false for preventDefault
      document.addEventListener('mouseup', globalMouseUpHandler);
      document.addEventListener('touchend', globalTouchEndHandler);
      document.addEventListener('touchcancel', globalTouchEndHandler);
    } else {
      document.removeEventListener('mousemove', handleInteractionMove);
      document.removeEventListener('touchmove', handleInteractionMove);
      document.removeEventListener('mouseup', globalMouseUpHandler);
      document.removeEventListener('touchend', globalTouchEndHandler);
      document.removeEventListener('touchcancel', globalTouchEndHandler);
    }

    return () => {
      document.removeEventListener('mousemove', handleInteractionMove);
      document.removeEventListener('touchmove', handleInteractionMove);
      document.removeEventListener('mouseup', globalMouseUpHandler);
      document.removeEventListener('touchend', globalTouchEndHandler);
      document.removeEventListener('touchcancel', globalTouchEndHandler);
    };
  }, [isDragging, handleInteractionMove, globalMouseUpHandler, globalTouchEndHandler]);


  return (
    <div
      ref={baseRef}
      className="fixed bottom-10 left-10 md:bottom-16 md:left-16 rounded-full select-none touch-none shadow-xl z-50 cursor-grab opacity-100"
      style={{ width: `${size}px`, height: `${size}px`, backgroundColor: baseColor, backdropFilter: 'blur(5px)' }}
      onMouseDown={handleInteractionStart}
      onTouchStart={handleInteractionStart}
    >
      <div
        className="joystick-knob absolute rounded-full"
        style={{
          width: `${stickSize}px`,
          height: `${stickSize}px`,
          backgroundColor: stickColor,
          top: `${(size - stickSize) / 2}px`,
          left: `${(size - stickSize) / 2}px`,
          transform: `translate(${knobPosition.x}px, ${knobPosition.y}px)`,
          cursor: isDragging ? 'grabbing' : 'grab',
        }}
      />
    </div>
  );
};