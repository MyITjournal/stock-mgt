import { checkVariant, variantKey, variantName } from './variants';

describe('product options (§24)', () => {
  describe('names', () => {
    it('joins the values, tidied', () => {
      expect(variantName(['  Onion   Chicken ', '70g'])).toBe(
        'Onion Chicken / 70g',
      );
      expect(variantName(['Chicken'])).toBe('Chicken');
    });

    it('keys on the name, case aside, so "chicken" and "Chicken" clash', () => {
      expect(variantKey(['chicken'])).toBe(variantKey([' Chicken ']));
      expect(variantKey(['Chicken', '70g'])).not.toBe(variantKey(['Chicken']));
    });
  });

  describe('checkVariant', () => {
    const chicken = { id: 'v-chicken', name: 'Chicken', isActive: true };
    const pepper = { id: 'v-pepper', name: 'Pepper Soup', isActive: false };
    const options = [chicken, pepper];
    const anywhere = { allowRetired: true };

    it('lets a product without options through with none named', () => {
      expect(checkVariant('Peak Milk', [], undefined, anywhere)).toBeNull();
      expect(checkVariant('Peak Milk', [], null, anywhere)).toBeNull();
    });

    it('refuses an option on a product that has none', () => {
      expect(() =>
        checkVariant('Peak Milk', [], 'v-chicken', anywhere),
      ).toThrow(/has no options/);
    });

    it('makes a product with options say which, naming the live ones', () => {
      expect(() =>
        checkVariant('Indomie', options, undefined, anywhere),
      ).toThrow(/"Indomie" comes in options \(Chicken\)\. Say which one\./);
    });

    it('refuses an option from another product', () => {
      expect(() =>
        checkVariant('Indomie', options, 'v-other', anywhere),
      ).toThrow(/does not belong to "Indomie"/);
    });

    it('returns the option named', () => {
      expect(checkVariant('Indomie', options, 'v-chicken', anywhere)).toBe(
        chicken,
      );
    });

    it('refuses a retired option for selling and receiving only', () => {
      expect(() =>
        checkVariant('Indomie', options, 'v-pepper', { allowRetired: false }),
      ).toThrow(/retired/);
      // Its leftover stock can still be counted, adjusted, moved, returned.
      expect(checkVariant('Indomie', options, 'v-pepper', anywhere)).toBe(
        pepper,
      );
    });
  });
});
