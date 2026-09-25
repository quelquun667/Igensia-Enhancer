// Exécuté dès le début du chargement (document_start) : la page ne garde par défaut
// que 250 entrées dans sa liste des fichiers chargés (Resource Timing), trop peu sur
// MonCampus. pdf_viewer.js y cherche le fichier PDF d'origine du visionneur.
try {
    performance.setResourceTimingBufferSize(3000);
} catch {
    // API indisponible : sans conséquence
}
