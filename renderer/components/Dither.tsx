'use client'

import { useRef, useEffect } from 'react'

// ── Ported from reactbits.dev/backgrounds/dither ──
// Pure WebGL — no Three.js/R3F dependency.
// Wave noise rendered in first pass, Bayer ordered-dither post-process in second pass.

const WAVE_VERT = `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`

const WAVE_FRAG = `
precision highp float;
varying vec2 vUv;
uniform vec2 resolution;
uniform float time;
uniform float waveSpeed;
uniform float waveFrequency;
uniform float waveAmplitude;
uniform vec3 waveColor;
uniform vec3 backgroundColor;
uniform vec2 mousePos;
uniform int enableMouseInteraction;
uniform float mouseRadius;

vec4 mod289v4(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289v4(((x*34.0)+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
vec2 fade(vec2 t){return t*t*t*(t*(t*6.0-15.0)+10.0);}

float cnoise(vec2 P){
  vec4 Pi=floor(P.xyxy)+vec4(0.0,0.0,1.0,1.0);
  vec4 Pf=fract(P.xyxy)-vec4(0.0,0.0,1.0,1.0);
  Pi=mod289v4(Pi);
  vec4 ix=Pi.xzxz,iy=Pi.yyww;
  vec4 fx=Pf.xzxz,fy=Pf.yyww;
  vec4 i=permute(permute(ix)+iy);
  vec4 gx=fract(i*(1.0/41.0))*2.0-1.0;
  vec4 gy=abs(gx)-0.5;
  vec4 tx=floor(gx+0.5);
  gx=gx-tx;
  vec2 g00=vec2(gx.x,gy.x),g10=vec2(gx.y,gy.y);
  vec2 g01=vec2(gx.z,gy.z),g11=vec2(gx.w,gy.w);
  vec4 norm=taylorInvSqrt(vec4(dot(g00,g00),dot(g01,g01),dot(g10,g10),dot(g11,g11)));
  g00*=norm.x;g01*=norm.y;g10*=norm.z;g11*=norm.w;
  float n00=dot(g00,vec2(fx.x,fy.x));
  float n10=dot(g10,vec2(fx.y,fy.y));
  float n01=dot(g01,vec2(fx.z,fy.z));
  float n11=dot(g11,vec2(fx.w,fy.w));
  vec2 fade_xy=fade(Pf.xy);
  vec2 n_x=mix(vec2(n00,n01),vec2(n10,n11),fade_xy.x);
  return 2.3*mix(n_x.x,n_x.y,fade_xy.y);
}

float fbm(vec2 p){
  float v=0.0,amp=1.0,freq=waveFrequency;
  for(int i=0;i<4;i++){v+=amp*abs(cnoise(p));p*=freq;amp*=waveAmplitude;}
  return v;
}

float pattern(vec2 p){
  vec2 p2=p-time*waveSpeed;
  return fbm(p+fbm(p2));
}

void main(){
  vec2 uv=gl_FragCoord.xy/resolution.xy;
  uv-=0.5;
  uv.x*=resolution.x/resolution.y;
  float f=pattern(uv);
  if(enableMouseInteraction==1){
    vec2 mNDC=(mousePos/resolution-0.5)*vec2(1.0,-1.0);
    mNDC.x*=resolution.x/resolution.y;
    float dist=length(uv-mNDC);
    f-=0.5*(1.0-smoothstep(0.0,mouseRadius,dist));
  }
  vec3 col=mix(backgroundColor,waveColor,clamp(f,0.0,1.0));
  gl_FragColor=vec4(col,1.0);
}
`

const DITHER_VERT = `
attribute vec2 position;
varying vec2 vUv;
void main(){
  vUv=position*0.5+0.5;
  gl_Position=vec4(position,0.0,1.0);
}
`

const DITHER_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2 resolution;
uniform float colorNum;
uniform float pixelSize;

float bayer8(int x,int y){
  float m[64];
  m[0]=0.0/64.0;m[1]=48.0/64.0;m[2]=12.0/64.0;m[3]=60.0/64.0;m[4]=3.0/64.0;m[5]=51.0/64.0;m[6]=15.0/64.0;m[7]=63.0/64.0;
  m[8]=32.0/64.0;m[9]=16.0/64.0;m[10]=44.0/64.0;m[11]=28.0/64.0;m[12]=35.0/64.0;m[13]=19.0/64.0;m[14]=47.0/64.0;m[15]=31.0/64.0;
  m[16]=8.0/64.0;m[17]=56.0/64.0;m[18]=4.0/64.0;m[19]=52.0/64.0;m[20]=11.0/64.0;m[21]=59.0/64.0;m[22]=7.0/64.0;m[23]=55.0/64.0;
  m[24]=40.0/64.0;m[25]=24.0/64.0;m[26]=36.0/64.0;m[27]=20.0/64.0;m[28]=43.0/64.0;m[29]=27.0/64.0;m[30]=39.0/64.0;m[31]=23.0/64.0;
  m[32]=2.0/64.0;m[33]=50.0/64.0;m[34]=14.0/64.0;m[35]=62.0/64.0;m[36]=1.0/64.0;m[37]=49.0/64.0;m[38]=13.0/64.0;m[39]=61.0/64.0;
  m[40]=34.0/64.0;m[41]=18.0/64.0;m[42]=46.0/64.0;m[43]=30.0/64.0;m[44]=33.0/64.0;m[45]=17.0/64.0;m[46]=45.0/64.0;m[47]=29.0/64.0;
  m[48]=10.0/64.0;m[49]=58.0/64.0;m[50]=6.0/64.0;m[51]=54.0/64.0;m[52]=9.0/64.0;m[53]=57.0/64.0;m[54]=5.0/64.0;m[55]=53.0/64.0;
  m[56]=42.0/64.0;m[57]=26.0/64.0;m[58]=38.0/64.0;m[59]=22.0/64.0;m[60]=41.0/64.0;m[61]=25.0/64.0;m[62]=37.0/64.0;m[63]=21.0/64.0;
  return m[y*8+x];
}

vec3 dither(vec2 uv,vec3 color){
  vec2 sc=floor(uv*resolution/pixelSize);
  int x=int(mod(sc.x,8.0));
  int y=int(mod(sc.y,8.0));
  float threshold=bayer8(x,y)-0.25;
  float step=1.0/(colorNum-1.0);
  color+=threshold*step;
  float lum=dot(color,vec3(0.2126,0.7152,0.0722));
  float bias=mix(0.2,0.0,smoothstep(0.45,0.8,lum));
  color=clamp(color-bias,0.0,1.0);
  return floor(color*(colorNum-1.0)+0.5)/(colorNum-1.0);
}

void main(){
  vec2 ps=pixelSize/resolution;
  vec2 uvSnap=ps*floor(vUv/ps);
  vec4 color=texture2D(tDiffuse,uvSnap);
  color.rgb=dither(vUv,color.rgb);
  gl_FragColor=color;
}
`

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!
  gl.shaderSource(s, src)
  gl.compileShader(s)
  return s
}

function buildProgram(gl: WebGLRenderingContext, vert: string, frag: string): WebGLProgram {
  const p = gl.createProgram()!
  gl.attachShader(p, compileShader(gl, gl.VERTEX_SHADER, vert))
  gl.attachShader(p, compileShader(gl, gl.FRAGMENT_SHADER, frag))
  gl.linkProgram(p)
  return p
}

function makeQuad(gl: WebGLRenderingContext, prog: WebGLProgram) {
  const buf = gl.createBuffer()!
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, 1,1]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(prog, 'position')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
  return buf
}

export interface DitherProps {
  waveColor?: [number, number, number]
  backgroundColor?: [number, number, number]
  waveSpeed?: number
  waveFrequency?: number
  waveAmplitude?: number
  colorNum?: number
  pixelSize?: number
  disableAnimation?: boolean
  enableMouseInteraction?: boolean
  mouseRadius?: number
  style?: React.CSSProperties
}

export default function Dither({
  waveColor = [0.5, 0.5, 0.5],
  backgroundColor = [0, 0, 0],
  waveSpeed = 0.05,
  waveFrequency = 3,
  waveAmplitude = 0.3,
  colorNum = 4,
  pixelSize = 2,
  disableAnimation = false,
  enableMouseInteraction = false,
  mouseRadius = 0.3,
  style,
}: DitherProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', { antialias: false, alpha: false })
    if (!gl) return

    const waveProg = buildProgram(gl, WAVE_VERT, WAVE_FRAG)
    const ditherProg = buildProgram(gl, DITHER_VERT, DITHER_FRAG)

    // Framebuffer for first pass
    const fb = gl.createFramebuffer()!
    let fbTex = gl.createTexture()!

    function resizeFbTex(w: number, h: number) {
      gl.bindTexture(gl.TEXTURE_2D, fbTex)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fbTex, 0)
    }

    let w = 0, h = 0
    function resize() {
      const dpr = Math.min(window.devicePixelRatio, 2)
      const nw = Math.floor(canvas.clientWidth * dpr)
      const nh = Math.floor(canvas.clientHeight * dpr)
      if (nw === w && nh === h) return
      w = nw; h = nh
      canvas.width = w; canvas.height = h
      resizeFbTex(w, h)
    }
    resize()

    const mouse = { x: 0, y: 0 }
    function onMouseMove(e: MouseEvent) {
      if (!enableMouseInteraction) return
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio, 2)
      mouse.x = (e.clientX - rect.left) * dpr
      mouse.y = (e.clientY - rect.top) * dpr
    }
    canvas.addEventListener('mousemove', onMouseMove)

    let raf: number
    let startTime = performance.now()

    function render() {
      resize()
      const t = disableAnimation ? 0 : (performance.now() - startTime) / 1000

      // Pass 1: wave into framebuffer
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb)
      gl.viewport(0, 0, w, h)
      gl.useProgram(waveProg)
      makeQuad(gl, waveProg)

      const setUni1f = (name: string, v: number) => gl.uniform1f(gl.getUniformLocation(waveProg, name), v)
      const setUni2f = (name: string, a: number, b: number) => gl.uniform2f(gl.getUniformLocation(waveProg, name), a, b)
      const setUni3f = (name: string, a: number, b: number, c: number) => gl.uniform3f(gl.getUniformLocation(waveProg, name), a, b, c)
      const setUni1i = (name: string, v: number) => gl.uniform1i(gl.getUniformLocation(waveProg, name), v)

      setUni2f('resolution', w, h)
      setUni1f('time', t)
      setUni1f('waveSpeed', waveSpeed)
      setUni1f('waveFrequency', waveFrequency)
      setUni1f('waveAmplitude', waveAmplitude)
      setUni3f('waveColor', waveColor[0], waveColor[1], waveColor[2])
      setUni3f('backgroundColor', backgroundColor[0], backgroundColor[1], backgroundColor[2])
      setUni2f('mousePos', mouse.x, mouse.y)
      setUni1i('enableMouseInteraction', enableMouseInteraction ? 1 : 0)
      setUni1f('mouseRadius', mouseRadius)

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

      // Pass 2: dither onto screen
      gl.bindFramebuffer(gl.FRAMEBUFFER, null)
      gl.viewport(0, 0, w, h)
      gl.useProgram(ditherProg)
      makeQuad(gl, ditherProg)

      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, fbTex)
      gl.uniform1i(gl.getUniformLocation(ditherProg, 'tDiffuse'), 0)
      gl.uniform2f(gl.getUniformLocation(ditherProg, 'resolution'), w, h)
      gl.uniform1f(gl.getUniformLocation(ditherProg, 'colorNum'), colorNum)
      gl.uniform1f(gl.getUniformLocation(ditherProg, 'pixelSize'), pixelSize)

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)

      raf = requestAnimationFrame(render)
    }
    render()

    return () => {
      cancelAnimationFrame(raf)
      canvas.removeEventListener('mousemove', onMouseMove)
      gl.deleteProgram(waveProg)
      gl.deleteProgram(ditherProg)
      gl.deleteFramebuffer(fb)
      gl.deleteTexture(fbTex)
    }
  }, [waveColor, backgroundColor, waveSpeed, waveFrequency, waveAmplitude, colorNum, pixelSize, disableAnimation, enableMouseInteraction, mouseRadius])

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height: '100%',
        display: 'block',
        ...style,
      }}
    />
  )
}
