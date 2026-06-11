import type { Schema, Struct } from '@strapi/strapi';

export interface SharedAgentCredit extends Struct.ComponentSchema {
  collectionName: 'components_shared_agent_credits';
  info: {
    displayName: 'Agent Credit';
    icon: 'user';
  };
  attributes: {
    agent: Schema.Attribute.Relation<'oneToOne', 'api::agent.agent'>;
    agent_role: Schema.Attribute.Relation<
      'oneToOne',
      'api::agent-role.agent-role'
    >;
    sortOrder: Schema.Attribute.Integer;
  };
}

export interface SharedImportProvenance extends Struct.ComponentSchema {
  collectionName: 'components_shared_import_provenances';
  info: {
    description: 'Private source traceability for imported records';
    displayName: 'Import Provenance';
  };
  attributes: {
    importBatchId: Schema.Attribute.String & Schema.Attribute.Required;
    lastImportedAt: Schema.Attribute.DateTime & Schema.Attribute.Required;
    reconciliationStatus: Schema.Attribute.Enumeration<
      ['not-required', 'pending', 'reconciled', 'blocked']
    > &
      Schema.Attribute.DefaultTo<'not-required'>;
    sourceChecksum: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.SetMinMaxLength<{
        maxLength: 64;
        minLength: 64;
      }>;
    sourceRecordId: Schema.Attribute.String & Schema.Attribute.Required;
    sourceSystem: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

export interface SharedInscription extends Struct.ComponentSchema {
  collectionName: 'components_shared_inscriptions';
  info: {
    displayName: 'Inscription';
    icon: 'quote';
  };
  attributes: {
    author: Schema.Attribute.Relation<'oneToOne', 'api::agent.agent'>;
    language: Schema.Attribute.String;
    position: Schema.Attribute.String;
    sortOrder: Schema.Attribute.Integer;
    text: Schema.Attribute.RichText &
      Schema.Attribute.Required &
      Schema.Attribute.CustomField<
        'plugin::ckeditor5.CKEditor',
        {
          preset: 'defaultHtml';
        }
      >;
    translation: Schema.Attribute.RichText &
      Schema.Attribute.CustomField<
        'plugin::ckeditor5.CKEditor',
        {
          preset: 'defaultHtml';
        }
      >;
    type: Schema.Attribute.Enumeration<
      ['signature', 'mark', 'caption', 'date', 'text', 'translation', 'other']
    > &
      Schema.Attribute.DefaultTo<'text'>;
  };
}

export interface SharedMedia extends Struct.ComponentSchema {
  collectionName: 'components_shared_media';
  info: {
    displayName: 'Media';
    icon: 'file-video';
  };
  attributes: {
    file: Schema.Attribute.Media<'images' | 'files' | 'videos'>;
  };
}

export interface SharedQuote extends Struct.ComponentSchema {
  collectionName: 'components_shared_quotes';
  info: {
    displayName: 'Quote';
    icon: 'indent';
  };
  attributes: {
    body: Schema.Attribute.Text;
    title: Schema.Attribute.String;
  };
}

export interface SharedRichText extends Struct.ComponentSchema {
  collectionName: 'components_shared_rich_texts';
  info: {
    description: '';
    displayName: 'Rich text';
    icon: 'align-justify';
  };
  attributes: {
    body: Schema.Attribute.RichText;
  };
}

export interface SharedSeo extends Struct.ComponentSchema {
  collectionName: 'components_shared_seos';
  info: {
    description: '';
    displayName: 'Seo';
    icon: 'allergies';
    name: 'Seo';
  };
  attributes: {
    metaDescription: Schema.Attribute.Text & Schema.Attribute.Required;
    metaTitle: Schema.Attribute.String & Schema.Attribute.Required;
    shareImage: Schema.Attribute.Media<'images'>;
  };
}

export interface SharedSlider extends Struct.ComponentSchema {
  collectionName: 'components_shared_sliders';
  info: {
    description: '';
    displayName: 'Slider';
    icon: 'address-book';
  };
  attributes: {
    files: Schema.Attribute.Media<'images', true>;
  };
}

export interface SharedWorkDescription extends Struct.ComponentSchema {
  collectionName: 'components_shared_work_descriptions';
  info: {
    displayName: 'Work Description';
    icon: 'file';
  };
  attributes: {
    author: Schema.Attribute.Relation<'oneToOne', 'api::agent.agent'>;
    bodyAr: Schema.Attribute.RichText &
      Schema.Attribute.CustomField<
        'plugin::ckeditor5.CKEditor',
        {
          preset: 'defaultHtml';
        }
      >;
    bodyEn: Schema.Attribute.RichText &
      Schema.Attribute.CustomField<
        'plugin::ckeditor5.CKEditor',
        {
          preset: 'defaultHtml';
        }
      >;
    labelAr: Schema.Attribute.String;
    labelEn: Schema.Attribute.String;
    sortOrder: Schema.Attribute.Integer;
    type: Schema.Attribute.Enumeration<['manuscript', 'object', 'general']> &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'general'>;
  };
}

export interface SharedWorkIdentifier extends Struct.ComponentSchema {
  collectionName: 'components_shared_work_identifiers';
  info: {
    displayName: 'Work Identifier';
    icon: 'key';
  };
  attributes: {
    preferred: Schema.Attribute.Boolean &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<false>;
    source: Schema.Attribute.String;
    type: Schema.Attribute.String &
      Schema.Attribute.Required &
      Schema.Attribute.DefaultTo<'IAB'>;
    value: Schema.Attribute.String & Schema.Attribute.Required;
  };
}

declare module '@strapi/strapi' {
  export module Public {
    export interface ComponentSchemas {
      'shared.agent-credit': SharedAgentCredit;
      'shared.import-provenance': SharedImportProvenance;
      'shared.inscription': SharedInscription;
      'shared.media': SharedMedia;
      'shared.quote': SharedQuote;
      'shared.rich-text': SharedRichText;
      'shared.seo': SharedSeo;
      'shared.slider': SharedSlider;
      'shared.work-description': SharedWorkDescription;
      'shared.work-identifier': SharedWorkIdentifier;
    }
  }
}
