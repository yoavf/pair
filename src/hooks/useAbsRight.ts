import { useEffect, useState } from "react";

/**
 * Detect specific phrase in content
 */
export function hasAbsolutelyRightPhrase(content: string): boolean {
	return content.toLowerCase().includes("you're absolutely right!");
}

const rainbowColors = [
	"#FF5F6D", // Coral red (255,95,109)
	"#FF9A3C", // Orange (255,154,60)
	"#FFD93D", // Bright yellow (255,217,61)
	"#4BE29A", // Mint green (75,226,154)
	"#4BDCFF", // Sky blue (75,220,255)
	"#9B5FFF", // Purple (155,95,255)
];

export const useAbsRight = (isActive: boolean) => {
	const [colorIndex, setColorIndex] = useState(0);

	useEffect(() => {
		if (!isActive) return;

		const interval = setInterval(() => {
			setColorIndex((prev) => (prev + 1) % rainbowColors.length);
		}, 200); // Change color every 200ms

		return () => clearInterval(interval);
	}, [isActive]);

	return isActive ? rainbowColors[colorIndex] : null;
};
