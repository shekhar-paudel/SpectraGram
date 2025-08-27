import Image from "next/image";

export function Logo() {
  return (
    <div className="w-full flex justify-center py-2">
      <div className="relative w-[100px] h-[100px] overflow-hidden">
        {/* Light mode */}
        <Image
          src="/logo/home.png"
          alt="SpectraGram Logo"
          fill
          className="block dark:hidden object-cover scale-110 origin-center"
          priority
        />
        {/* Dark mode */}
        <Image
          src="/logo/home_dark.png"
          alt="SpectraGram Logo (Dark)"
          fill
          className="hidden dark:block object-cover scale-110 origin-center"
          priority
        />
      </div>
    </div>
  );
}
