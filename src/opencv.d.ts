declare module 'opencv.js' {
  export interface Mat {
    rows: number;
    cols: number;
    data: Uint8Array;
    size(): { width: number; height: number };
    roi(rect: Rect): Mat;
    delete(): void;
  }

  export interface Point {
    x: number;
    y: number;
  }

  export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
  }

  export interface Size {
    width: number;
    height: number;
  }

  export interface KeyPoint {
    pt: Point;
  }

  export interface DMatch {
    queryIdx: number;
    trainIdx: number;
    distance: number;
  }

  export interface KeyPointVector {
    size(): number;
    get(index: number): KeyPoint;
    delete(): void;
  }

  export interface DMatchVector {
    size(): number;
    get(index: number): DMatch;
    delete(): void;
  }

  export interface DMatchVectorVector {
    size(): number;
    get(index: number): DMatchVector;
    delete(): void;
  }

  export interface MatOfByte {
    toArray(): Uint8Array;
    delete(): void;
  }

  export class SIFT {
    detectAndCompute(
      image: Mat,
      mask: Mat,
      keypoints: KeyPointVector,
      descriptors: Mat
    ): void;
    delete(): void;
  }

  export class BFMatcher {
    constructor(normType: number, crossCheck: boolean);
    knnMatch(
      queryDescriptors: Mat,
      trainDescriptors: Mat,
      matches: DMatchVectorVector,
      k: number
    ): void;
    delete(): void;
  }

  export interface MinMaxLocResult {
    minVal: number;
    maxVal: number;
    minLoc: Point;
    maxLoc: Point;
  }

  export interface Scalar {
    0: number; 1: number; 2: number; 3: number;
  }

  export const CV_8UC4: number;
  export const CV_8UC1: number;
  export const CV_32F: number;
  export const CV_32FC2: number;
  export const COLOR_RGBA2GRAY: number;
  export const COLOR_BGR2GRAY: number;
  export const TM_CCOEFF_NORMED: number;
  export const TM_SQDIFF: number;
  export const THRESH_BINARY: number;
  export const THRESH_OTSU: number;
  export const RANSAC: number;
  export const NORM_L2: number;
  export const INTER_CUBIC: number;
  export const BORDER_CONSTANT: number;
  export const FONT_HERSHEY_SIMPLEX: number;
  export const NATIVE_LIBRARY_NAME: string;

  export function cvtColor(src: Mat, dst: Mat, code: number): void;
  export function matchTemplate(
    image: Mat,
    templ: Mat,
    result: Mat,
    method: number,
    mask?: Mat
  ): void;
  export function minMaxLoc(src: Mat): MinMaxLocResult;
  export function absdiff(src1: Mat, src2: Mat, dst: Mat): void;
  export function threshold(
    src: Mat,
    dst: Mat,
    thresh: number,
    maxval: number,
    type: number
  ): void;
  export function countNonZero(src: Mat): number;
  export function matFromArray(
    rows: number,
    cols: number,
    type: number,
    array: number[]
  ): Mat;
  export function findHomography(
    srcPoints: Mat,
    dstPoints: Mat,
    method: number,
    ransacReprojThreshold: number
  ): Mat;
  export function warpPerspective(
    src: Mat,
    dst: Mat,
    M: Mat,
    dsize: Size
  ): void;
  export function imencode(ext: string, img: Mat, buf: MatOfByte): boolean;
  export function resize(src: Mat, dst: Mat, dsize: Size, fx?: number, fy?: number, interpolation?: number): void;
  export function copyMakeBorder(src: Mat, dst: Mat, top: number, bottom: number, left: number, right: number, borderType: number, value?: Scalar): void;
  export function rectangle(img: Mat, pt1: Point, pt2: Point, color: Scalar, thickness?: number): void;
  export function putText(img: Mat, text: string, org: Point, fontFace: number, fontScale: number, color: Scalar, thickness?: number): void;

  const cv: {
    Mat: typeof Mat;
    SIFT: typeof SIFT;
    BFMatcher: typeof BFMatcher;
    KeyPointVector: new () => KeyPointVector;
    DMatchVectorVector: new () => DMatchVectorVectorConstructor;
    MatOfByte: new () => MatOfByte;
    Rect: new (x: number, y: number, width: number, height: number) => Rect;
    Size: new (width: number, height: number) => Size;
    Point: new (x: number, y: number) => Point;
    Scalar: new (v0: number, v1: number, v2: number, v3: number) => Scalar;
    CV_8UC4: number;
    CV_8UC1: number;
    CV_32F: number;
    CV_32FC2: number;
    COLOR_RGBA2GRAY: number;
    COLOR_BGR2GRAY: number;
    TM_CCOEFF_NORMED: number;
    TM_SQDIFF: number;
    THRESH_BINARY: number;
    THRESH_OTSU: number;
    RANSAC: number;
    NORM_L2: number;
    INTER_CUBIC: number;
    BORDER_CONSTANT: number;
    FONT_HERSHEY_SIMPLEX: number;
    NATIVE_LIBRARY_NAME: string;
    cvtColor: typeof cvtColor;
    matchTemplate: typeof matchTemplate;
    minMaxLoc: typeof minMaxLoc;
    absdiff: typeof absdiff;
    threshold: typeof threshold;
    countNonZero: typeof countNonZero;
    matFromArray: typeof matFromArray;
    findHomography: typeof findHomography;
    warpPerspective: typeof warpPerspective;
    imencode: typeof imencode;
    resize: typeof resize;
    copyMakeBorder: typeof copyMakeBorder;
    rectangle: typeof rectangle;
    putText: typeof putText;
  };

  export default cv;
}
