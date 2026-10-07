// rule: nextjs-image-missing-sizes
// weakness: library-idiom
// verdict: pass
import Image from "next/image";
export const Cover = () => <Image fill unoptimized src="/cover.png" alt="Cover" />;
