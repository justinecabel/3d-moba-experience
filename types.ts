

import * as THREE from 'three';

export interface JoystickOutput {
  x: number; // Range -1 to 1 (left/right relative to base)
  y: number; // Range -1 to 1 (up/down relative to base, typically y positive is down, y negative is up for UI, but often inverted for 3D 'forward')
  active: boolean; // True if joystick is being interacted with
}

// API_KEY related declarations are removed as Gemini functionality is no longer used.
