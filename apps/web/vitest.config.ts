import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

/**
 * `server-only`을 빈 모듈로 별칭한다 — 이게 없으면 lib/kis/client.ts를
 * vitest가 로드하지 못한다("Failed to load url server-only"). 그래서 이 프록시의
 * 핵심 안전 속성인 타임아웃 예산이 테스트 0건으로 남아 있었다(#39 리뷰).
 * 런타임 보호는 Next가 빌드 시점에 하고, 여기서는 모듈을 열기만 한다.
 */
export default defineConfig({
  resolve: {
    alias: {
      "server-only": resolve(__dirname, "test/stubs/empty.ts"),
      "@": resolve(__dirname),
    },
  },
});
