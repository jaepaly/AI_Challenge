import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * 엔진은 빌드물 없이 TS 소스를 직접 노출한다(package.json main: src/index.ts).
   * "계산은 엔진만 한다"는 원칙 때문에 웹은 엔진을 직접 import 하므로 트랜스파일 대상에 넣는다.
   */
  transpilePackages: ["@marginguard/engine"],
};

export default nextConfig;
