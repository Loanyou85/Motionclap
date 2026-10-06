/**
 * Modèle de données d'Atelier Motion.
 * Tout est sérialisable en JSON : un projet peut être sauvegardé tel quel.
 * Les temps sont exprimés en secondes, les positions en pixels de composition.
 */

export type LayerType =
  | 'rect'
  | 'ellipse'
  | 'star'
  | 'polygon'
  | 'line'
  | 'text'
  | 'image'
  | 'path'
  | 'group'
  | 'precomp';

/** Nature d'une propriété animable : détermine la façon d'interpoler. */
export type PropType = 'number' | 'color' | 'path';

/** Nombre, couleur (#RRGGBB / #RRGGBBAA) ou tracé SVG (attribut d). */
export type PropValue = number | string;

export type EasingType =
  | 'linear'
  | 'easeIn'
  | 'easeOut'
  | 'easeInOut'
  | 'cubicBezier'
  | 'backIn'
  | 'backOut'
  | 'backInOut'
  | 'elasticIn'
  | 'elasticOut'
  | 'bounceIn'
  | 'bounceOut'
  | 'hold';

export type Bezier = [number, number, number, number];

export interface Easing {
  type: EasingType;
  /** Points de contrôle, utilisés quand type === 'cubicBezier'. */
  bezier?: Bezier;
}

/**
 * Image clé. L'easing décrit la courbe du segment qui part de cette image clé
 * vers la suivante (convention After Effects « sortante »).
 */
export interface Keyframe {
  id: string;
  time: number;
  value: PropValue;
  easing: Easing;
}

/** Propriété animable : valeur statique tant qu'il n'y a pas d'image clé. */
export interface AnimProp {
  value: PropValue;
  keyframes: Keyframe[];
}

export type PropKey =
  | 'x'
  | 'y'
  | 'scaleX'
  | 'scaleY'
  | 'rotation'
  | 'opacity'
  | 'blur'
  | 'fill'
  | 'stroke'
  | 'strokeWidth'
  | 'width'
  | 'height'
  | 'radius'
  | 'innerRadius'
  | 'points'
  | 'trim'
  | 'path'
  | 'fontSize'
  | 'letterSpacing'
  | 'reveal'
  | 'waveAmp';

export type TextMode = 'none' | 'typewriter' | 'fade' | 'wave';
export type TextAlign = 'left' | 'center' | 'right';

export interface Layer {
  id: string;
  name: string;
  type: LayerType;
  visible: boolean;
  locked: boolean;
  /** Parentage : le calque hérite de la transformation de son parent. */
  parentId: string | null;
  /** Calque utilisé comme masque (couche alpha). Le calque masque n'est pas dessiné. */
  maskId: string | null;
  maskInvert: boolean;
  /** Plage d'affichage du calque, en secondes. */
  inPoint: number;
  outPoint: number;
  props: Partial<Record<PropKey, AnimProp>>;
  /** Groupes : repliés dans le panneau des calques. */
  collapsed?: boolean;
  /** Timeline : afficher les pistes de propriétés. */
  expanded?: boolean;
  // Champs statiques selon le type
  text?: string;
  fontFamily?: string;
  fontWeight?: number;
  textAlign?: TextAlign;
  textMode?: TextMode;
  assetId?: string;
  compId?: string;
}

export interface AudioTrack {
  assetId: string;
  /** Décalage du début du son dans la composition (s). */
  offset: number;
  volume: number;
  muted: boolean;
}

export interface Composition {
  id: string;
  name: string;
  width: number;
  height: number;
  duration: number;
  fps: number;
  background: string;
  /** Ordre d'empilement : index 0 = calque du dessous. */
  layers: Layer[];
  audio: AudioTrack | null;
}

export type AssetKind = 'image' | 'audio';

export interface Asset {
  id: string;
  name: string;
  kind: AssetKind;
  /** Données encodées (data URL) pour rester autonome hors ligne. */
  src: string;
  width?: number;
  height?: number;
  duration?: number;
}

export interface Project {
  version: 1;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  mainCompId: string;
  compositions: Composition[];
  assets: Asset[];
}

/** Valeurs évaluées d'un calque à un instant donné. */
export type EvaluatedProps = Record<PropKey, PropValue>;
