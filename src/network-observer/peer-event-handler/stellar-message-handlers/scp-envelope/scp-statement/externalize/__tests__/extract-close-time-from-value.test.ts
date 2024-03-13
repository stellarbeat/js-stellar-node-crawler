import { extractCloseTimeFromValue } from '../extract-close-time-from-value';
import { createDummyExternalizeMessage } from '../../../../../../../__fixtures__/createDummyExternalizeMessage';

describe('extract-close-time-from-value', () => {
	it('should extract close time from value', () => {
		const externalizeMessage = createDummyExternalizeMessage();
		const value = externalizeMessage
			.envelope()
			.statement()
			.pledges()
			.externalize()
			.commit()
			.value();
		const result = extractCloseTimeFromValue(value);
		expect(result).toEqual(new Date('2024-02-27T08:36:24.000Z'));
	});
});
