import Landing from "./landing";
import { readBuildInfo } from "@/lib/build-info";

export default function Home() {
  // 서버에서 읽어 prop으로 내린다 — VERCEL_GIT_COMMIT_SHA는 NEXT_PUBLIC_이
  // 아니라 클라이언트 번들에서 못 읽는다
  return <Landing build={readBuildInfo()} />;
}
