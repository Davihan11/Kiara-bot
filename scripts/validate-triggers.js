// CI check: validates that every trigger expression in src/utils/triggers
// tokenizes, parses and compiles without throwing, and that the compiled
// AST can be evaluated without crashing.
const { tokenize, parse, evaluate, compile } = require('../src/utils/parser');
const triggers = require('../src/utils/triggers');

let failed = 0;

if (!Array.isArray(triggers) || triggers.length === 0) {
	console.error('Triggers file did not export a non-empty array.');
	process.exit(1);
}

triggers.forEach((trigger, index) => {
	const label = `trigger #${index + 1}`;

	if (typeof trigger.expression !== 'string' || trigger.expression.trim() === '') {
		console.error(`${label}: missing or non-string "expression".`);
		failed++;
		return;
	}

	if (!Array.isArray(trigger.replies) || trigger.replies.length === 0) {
		console.error(`${label} ("${trigger.expression}"): "replies" must be a non-empty array.`);
		failed++;
		return;
	}

	try {
		const ast = compile(parse(tokenize(trigger.expression)));
		// smoke-test evaluation so a broken compiled AST can't crash the bot at runtime
		evaluate(ast, 'ci validation sample message');
		console.log(`${label}: OK -> "${trigger.expression}"`);
	}
	catch (e) {
		console.error(`${label}: INVALID expression "${trigger.expression}": ${e.message}`);
		failed++;
	}
});

if (failed > 0) {
	console.error(`\n${failed} trigger(s) failed validation.`);
	process.exit(1);
}

console.log(`\nAll ${triggers.length} trigger expressions compiled successfully.`);
