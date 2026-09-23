import type { SVGProps } from "react";
import {
  BRAND_COLORS,
  LOGO_FACES,
  LOGO_ORBIT,
  LOGO_ORBIT_FRONT,
  LOGO_ORBIT_KNOCKOUT,
  LOGO_SATELLITE,
  LOGO_VIEWBOX,
} from "./logo-geometry";

export interface LogoMarkProps extends Omit<
  SVGProps<SVGSVGElement>,
  "children" | "role" | "viewBox"
> {
  /**
   * Accessible name. When provided the mark is exposed as an image with this
   * name; when omitted it is decorative and hidden from assistive technology.
   */
  title?: string;
  /**
   * Color of the thin gap that separates the orbit from the tower. Match the
   * surface the mark sits on (defaults to the "void" background).
   */
  knockout?: string;
}

/**
 * The CodeVerse symbol: an isometric building with an orbit passing through it.
 * Pure SVG with flat fills (no gradients or ids), so any number of instances can
 * share a page and it stays crisp down to 16px.
 */
export function LogoMark({
  title,
  knockout = BRAND_COLORS.void,
  width = 32,
  height = 32,
  ...props
}: LogoMarkProps) {
  const accessibility = title
    ? ({ role: "img", "aria-label": title } as const)
    : ({ "aria-hidden": true, focusable: false } as const);

  return (
    <svg
      viewBox={`0 0 ${LOGO_VIEWBOX} ${LOGO_VIEWBOX}`}
      width={width}
      height={height}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...accessibility}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      <ellipse
        cx={LOGO_ORBIT.cx}
        cy={LOGO_ORBIT.cy}
        rx={LOGO_ORBIT.rx}
        ry={LOGO_ORBIT.ry}
        stroke={BRAND_COLORS.ink}
        strokeOpacity={0.45}
        strokeWidth={LOGO_ORBIT.strokeWidth}
      />
      <path d={LOGO_FACES.top} fill={BRAND_COLORS.signal} />
      <path d={LOGO_FACES.left} fill={BRAND_COLORS.ion} />
      <path d={LOGO_FACES.right} fill={BRAND_COLORS.signalDim} />
      <path d={LOGO_ORBIT_KNOCKOUT} stroke={knockout} strokeWidth={LOGO_ORBIT.strokeWidth * 2.2} />
      <path
        d={LOGO_ORBIT_FRONT}
        stroke={BRAND_COLORS.ink}
        strokeWidth={LOGO_ORBIT.strokeWidth}
        strokeLinecap="round"
      />
      <circle
        cx={LOGO_SATELLITE.cx}
        cy={LOGO_SATELLITE.cy}
        r={LOGO_SATELLITE.r}
        fill={BRAND_COLORS.signal}
        stroke={knockout}
        strokeWidth={1}
      />
    </svg>
  );
}
