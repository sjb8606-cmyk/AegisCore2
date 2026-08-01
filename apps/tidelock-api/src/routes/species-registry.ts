import { Router } from 'express';
import { getCurrentTenantId } from '../../../../platform/tenancy/src/index';
import { SpeciesRegistryService } from '../../../../platform/fisheries/species-registry/src/index';

const router = Router();

router.post('/', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const species = await SpeciesRegistryService.createSpecies(tenantId, req.auth.sub, req.body);
    res.status(201).json(species);
  } catch (err) { next(err); }
});

router.get('/:id', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const species = await SpeciesRegistryService.getSpecies(tenantId, req.params.id);
    res.status(200).json(species);
  } catch (err) { next(err); }
});

router.get('/', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const activeOnly = req.query.activeOnly !== 'false';
    const species = await SpeciesRegistryService.listSpecies(tenantId, { activeOnly });
    res.status(200).json(species);
  } catch (err) { next(err); }
});

router.patch('/:id', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const species = await SpeciesRegistryService.updateSpecies(tenantId, req.params.id, req.auth.sub, req.body);
    res.status(200).json(species);
  } catch (err) { next(err); }
});

router.post('/:id/deactivate', async (req: any, res, next) => {
  try {
    const tenantId = getCurrentTenantId();
    const species = await SpeciesRegistryService.deactivateSpecies(tenantId, req.params.id, req.auth.sub);
    res.status(200).json(species);
  } catch (err) { next(err); }
});

export default router;
