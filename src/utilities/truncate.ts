export function truncate(str?: string) {
	if (!str) return str;
	return str.length > 20
		? str.substring(0, 5) + '...' + str.substring(str.length - 5, str.length)
		: str;
}
