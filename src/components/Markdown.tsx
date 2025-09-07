import { Text } from "ink";
import { parse, setOptions } from "marked";
import TerminalRenderer, {
	type TerminalRendererOptions,
} from "marked-terminal";
import type React from "react";

type Props = TerminalRendererOptions & {
	children: string;
};

const Markdown: React.FC<Props> = ({ children, ...options }) => {
	try {
		// biome-ignore lint/suspicious/noExplicitAny: marked-terminal renderer lacks precise TS types
		setOptions({ renderer: new TerminalRenderer(options) as any });
		const parsed = parse(children);
		const result = typeof parsed === "string" ? parsed.trim() : children;
		return <Text>{result}</Text>;
	} catch (_error) {
		// Fallback to plain text if markdown parsing fails
		return <Text>{children}</Text>;
	}
};

export default Markdown;
