import { describe, expect, it } from 'vitest';
import { parseVesselForm, vesselForm } from './vessels';

describe('parseVesselForm', () => {
  it('needs a name and a weight', () => {
    expect(parseVesselForm(vesselForm())).toMatchObject({ values: null, errors: { name: 'Required' } });
    expect(parseVesselForm(vesselForm()).errors.weight).toBeTruthy();
  });
  it('takes a comma, and trims the name', () => {
    expect(parseVesselForm({ name: ' Carafe ', weight: '312,5' }).values).toEqual({ name: 'Carafe', weightGrams: 312.5 });
  });
  it('refuses a weight of 0 or too many decimals', () => {
    expect(parseVesselForm({ name: 'Cup', weight: '0' }).values).toBeNull();
    expect(parseVesselForm({ name: 'Cup', weight: '1.234' }).values).toBeNull();
  });
});
