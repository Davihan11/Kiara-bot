// tokenize the content into Tokens for parser
function tokenize(expression) {
	const tokens = [];
	let i = 0;
	while (i < expression.length) {
		const char = expression[i];
		switch (char) {
		case '&': // found first & character, checking for &&
			if (expression[i + 1] === '&') {
				i += 2;
				tokens.push({ type: 'AND' });
				continue;
			}
			break;
		case '|': // found first | character, checking for ||
			if (expression[i + 1] === '|') {
				i += 2;
				tokens.push({ type: 'OR' });
				continue;
			}
			break;
		case '(': // left parenthesis
			tokens.push({ type: 'LPAREN' });
			i++;
			break;
		case ')': // right parenthesis
			tokens.push({ type: 'RPAREN' });
			i++;
			break;
		case ' ': // whitespace
		case '\t': // tab
		case '\n': // newline
			i++;
			break;
		// quoted phrase: scan until the matching closing quote
		case '"':
		case '\'': {
			let value = '';
			i++;
			while (i < expression.length && expression[i] !== char) {
				value += expression[i];
				i++;
			}
			if (i >= expression.length) {
				throw new Error(`Unterminated quote in: "${expression}"`);
			}
			tokens.push({ type: 'WORD', value: value.toLowerCase() });
			i++;
			break;
		}
		// bare word: consume until a special character or whitespace
		default: {
			const match = /^[^&|()\s'"]+/.exec(expression.slice(i));
			tokens.push({ type: 'WORD', value: match[0].toLowerCase() });
			i += match[0].length;
			break;
		}
		}
	}
	return tokens;
}

// parse the tokens into an AST
function parse(tokens) {
	let pos = 0; // initialize the position to the start of the tokens array
	const peek = () => tokens[pos]; // peek at the current token without consuming it
	const consume = () => tokens[pos++]; // consume the current token and move to the next one

	function parseOr() { // entry point (lowest priority operator)
		let left = parseAnd(); // check left side of or
		while (peek()?.type === 'OR') { // check if we are OR
			consume(); // if yes, move to the right
			left = { operator: 'OR', left, right: parseAnd() }; // parse the right side and add it to left
		}
		return left;
	}

	function parseAnd() { // 2nd priority operator
		let left = parseAtom(); // check left side
		while (peek()?.type === 'AND') { // check if we are an AND
			consume(); // move to the right
			left = { operator: 'AND', left, right: parseAtom() }; // parse right side
		}
		return left;
	}

	function parseAtom() { // hightest priority
		switch (peek()?.type) { // check what are we
		case 'WORD': // if word
			return { operator: 'WORD', value: consume().value }; // save the value of the word
		case 'LPAREN': // if left (
			consume(); // consume it
			const node = parseOr(); // start recursive cycle again
			if (peek()?.type !== 'RPAREN') throw new Error('Missing closing parenthesis'); // find )
			consume(); // consume it
			return node; // return
		default:
			throw new Error(`Unexpected token: ${JSON.stringify(peek()?.type)}`); // wrong syntax
		}
	}

	const ast = parseOr(); // start parsing with the lowest precedence operator (OR)
	if (pos !== tokens.length) throw new Error('Unexpected trailing tokens'); // extra incorrect tokens
	return ast; // return the constructed AST
}

function evaluate(node, content) { // evaluate expressions
	switch (node.operator) {
	case 'WORD': {
		return node.regex.test(content);
	}
	case 'AND': return evaluate(node.left, content) && evaluate(node.right, content);
	case 'OR': return evaluate(node.left, content) || evaluate(node.right, content);
	default: throw new Error(`Unknown node op: ${node.operator}`);
	}
}

function compile(node) { // bot optimalisation cause RegExp can get tough
	switch (node.operator) {
	case 'WORD':
		const escaped = node.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		node.regex = new RegExp(`\\b${escaped}\\b`);
		break;
	case 'AND':
	case 'OR':
		compile(node.left);
		compile(node.right);
		break;
	}
	return node;
}

module.exports = { tokenize, parse, evaluate, compile };