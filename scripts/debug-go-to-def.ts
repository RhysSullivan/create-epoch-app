import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const reactConfigPath = path.join(projectRoot, "packages/react/tsconfig.json");
const configFile = ts.readConfigFile(reactConfigPath, ts.sys.readFile);
const parsedConfig = ts.parseJsonConfigFileContent(
	configFile.config,
	ts.sys,
	path.dirname(reactConfigPath),
);

function findNodeAtPosition(
	node: ts.Node,
	position: number,
): ts.Node | undefined {
	if (position >= node.getStart() && position < node.getEnd()) {
		for (const child of node.getChildren()) {
			const found = findNodeAtPosition(child, position);
			if (found) return found;
		}
		return node;
	}
	return undefined;
}

const testPatterns = [
	{
		file: path.join(projectRoot, "packages/react/src/guestbook-rpc.tsx"),
		pattern: "client.list",
		offset: "client.".length,
	},
	{
		file: path.join(projectRoot, "packages/database/convex/rpc/guestbook.ts"),
		pattern: "guestbookModule.handlers",
		offset: "guestbookModule.".length,
	},
];

const program = ts.createProgram({
	rootNames: testPatterns.map((t) => t.file),
	options: parsedConfig.options,
});

const checker = program.getTypeChecker();

for (const { file, pattern, offset } of testPatterns) {
	const sf = program.getSourceFile(file);
	if (!sf) {
		console.log(`Could not load ${file}`);
		continue;
	}

	const content = sf.getFullText();
	const idx = content.indexOf(pattern);
	if (idx === -1) {
		console.log(`Could not find "${pattern}" in ${file}`);
		continue;
	}

	const pos = idx + offset;
	console.log(`\n${"=".repeat(60)}`);
	console.log(`Analyzing "${pattern}" in ${path.basename(file)}`);
	console.log(`${"=".repeat(60)}\n`);

	const n = findNodeAtPosition(sf, pos);
	if (!n) {
		console.log("Could not find node");
		continue;
	}

	console.log("Node text:", n.getText());
	console.log("Node kind:", ts.SyntaxKind[n.kind]);

	const sym = checker.getSymbolAtLocation(n);
	if (sym) {
		console.log("\nSymbol name:", sym.getName());
		const decls = sym.getDeclarations();
		if (decls && decls.length > 0) {
			console.log("\n=== Declarations (Go-to-Definition targets) ===");
			for (const d of decls) {
				const dsf = d.getSourceFile();
				const { line, character } = dsf.getLineAndCharacterOfPosition(
					d.getStart(),
				);
				console.log(`  ${dsf.fileName}:${line + 1}:${character + 1}`);
				console.log(`  Kind: ${ts.SyntaxKind[d.kind]}`);
			}
		} else {
			console.log(
				"\n!!! No declarations found - go-to-definition won't work !!!",
			);
		}
	} else {
		console.log("\n!!! No symbol found !!!");
	}

	const t = checker.getTypeAtLocation(n);
	console.log("\nType:", checker.typeToString(t).slice(0, 200));
}
