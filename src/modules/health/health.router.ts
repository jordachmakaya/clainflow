
import {Router} from "express"

// Utilisé par le load balancer AWS pour savoir si le conteneur est en vie.
export  function createHealthRouter():Router {
    const router = Router();
    router.get('/', (req, res) => {
        res.status(200).json({status: 'OK'});
    })

    return router;
}