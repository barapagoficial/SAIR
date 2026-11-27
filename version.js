self.SAIR_VERSION = {
  numero: "4.6.0",
  canal: "Oficial A"
};
self.SAIR_VERSION.texto = self.SAIR_VERSION.numero + " " + self.SAIR_VERSION.canal;
self.SAIR_VERSION.cache = "sair-v" + self.SAIR_VERSION.numero + "-" + self.SAIR_VERSION.canal.toLowerCase().replace(/[^a-z0-9]+/g, "-");
