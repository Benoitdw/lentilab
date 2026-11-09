# Simulateur de myopie (WebXR)

Webapp Three.js : une scène (lecture de près, panneaux de 1 à 50 m, échelle de Snellen à 6 m, rue, montagnes)
vue à travers une myopie simulée de X dioptries.

## Lancer en local (PC)

```sh
python3 -m http.server 8000
# puis http://localhost:8000
```

Pour tester la VR sans casque : extension Chrome « Immersive Web Emulator » (Meta).

## Téléphone (Cardboard) et casque (Quest…)

Le gyroscope et WebXR exigent du **HTTPS**. Au choix :
- tunnel temporaire : `npx localtunnel --port 8000` ou `cloudflared tunnel --url http://localhost:8000`
- hébergement statique : GitHub Pages, Netlify (glisser-déposer le dossier)

Ouvrir l'URL dans le navigateur du Quest → bouton « ENTER VR ».
Sur téléphone → « Mode Cardboard », puis mettre le téléphone dans un viewer.

## Modèle optique

Tracé de rayons géométrique à travers la pupille (`computeLUT` dans `main.js`) :

- pour un point p de la pupille, décalage sur la rétine o = E·p (rad), avec
  E = P_lentille + ΔP(|p|)·I − P_ordonnance + (A − V)·I
  (matrices de puissance sphère/cylindre/axe, V = 1/distance, A = accommodation)
- ΔP(r) = profil de puissance radial de la lentille (modèles illustratifs, pas des données fabricant)
- l'œil choisit l'accommodation A ∈ [0, Amax] qui maximise l'énergie dans 2′ d'arc ;
  Amax selon Hofstetter (18,5 − 0,3 × âge)
- les taches sont précalculées pour 128 vergences, puis appliquées par pixel selon la profondeur.

Limites : optique géométrique (pas de diffraction ni d'aberrations propres de l'œil), lentille supposée
centrée sur la pupille, accommodation « idéale » pour chaque distance, focale fixe de l'écran du casque.
